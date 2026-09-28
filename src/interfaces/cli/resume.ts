import { createInterface } from "node:readline/promises";
import type { CodexCliEvent, CodexCliOpenedSession } from "../../application/ports/codex-cli.js";
import {
  completerForSkills,
  renderActivity,
  renderAssistantStart,
  renderHelp,
  renderInputPrompt,
  renderNotice,
  renderQuestionPrompt,
  renderSessionHeader,
  renderSkillCatalog,
  renderTurnComplete,
} from "./terminal-ui.js";
import { sanitizeTerminalChunk } from "./terminal-text.js";

type Ask = (prompt: string) => Promise<string>;
type SkillInvocation = { selector: string; request: string };

export type CodexResumeActions = {
  validateTarget(target: string): void;
  openSession(target: string, threadId: string): Promise<CodexCliOpenedSession>;
  buildSkillInput(target: string, threadId: string, selector: string, request: string): Promise<{ inputText: string; skill: { name: string; provider: string } }>;
  sendPrompt(target: string, threadId: string, text: string): Promise<void>;
  answerApproval(target: string, requestId: number | string, decision: "accept" | "acceptForSession" | "decline"): Promise<void>;
  subscribe(listener: (event: CodexCliEvent) => void): () => void;
  disconnect(target: string): Promise<void>;
};

/** Interactive terminal interface for resuming a Codex session through application actions. */
export async function resumeCodexThread(target: string, threadId: string, actions: CodexResumeActions): Promise<void> {
  actions.validateTarget(target);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) throw new Error("Thread ID contains unsupported characters");
  if (!process.stdin.isTTY) throw new Error("The resume command needs an interactive terminal");

  let reader: ReturnType<typeof createInterface> | undefined;
  const ask: Ask = (prompt) => {
    if (!reader) return Promise.reject(new Error("The Codex session prompt is not ready"));
    return reader.question(prompt);
  };
  let resolveCurrentTurn: (() => void) | undefined;
  let assistantOutputOpen = false;
  const unsubscribe = actions.subscribe((event) => {
    if (event.target !== target || event.threadId !== threadId) return;
    if (event.type === "commandApproval" || event.type === "fileApproval") {
      void handleApprovalRequest(event, actions, ask).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`\n${renderNotice(`Could not answer Codex request: ${message}`, "error")}`);
        void actions.answerApproval(target, event.requestId!, "decline").catch(() => undefined);
      });
      return;
    }

    if (event.type === "commandStarted") {
      process.stderr.write(`\n${renderActivity("COMMAND", event.command)}`);
    } else if (event.type === "fileChangesStarted") {
      process.stderr.write(`\n${renderActivity("FILE CHANGES", "Codex is preparing edits")}`);
    } else if (event.type === "assistantDelta") {
      if (event.text.length > 0) {
        if (!assistantOutputOpen) {
          process.stdout.write(renderAssistantStart());
          assistantOutputOpen = true;
        }
        process.stdout.write(sanitizeTerminalChunk(event.text));
      }
    } else if (event.type === "turnCompleted") {
      if (assistantOutputOpen) process.stdout.write("\n");
      process.stdout.write(`${renderTurnComplete(event.status)}\n`);
      assistantOutputOpen = false;
      if (event.error) process.stderr.write(renderNotice(`Codex error: ${event.error}`, "error"));
      resolveCurrentTurn?.();
      resolveCurrentTurn = undefined;
    } else if (event.type === "warning") {
      process.stderr.write(`\n${renderNotice(`Codex warning: ${event.message}`, "warning")}`);
    }
  });

  try {
    const session = await actions.openSession(target, threadId);
    reader = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
      completer: completerForSkills(session.skillCatalog.skills),
    });
    renderSessionHeader({
      target: session.targetLabel,
      threadId,
      ...(session.title ? { title: session.title } : {}),
      ...(session.cwd ? { cwd: session.cwd } : {}),
      skillCount: session.skillCatalog.skills.length,
    });
    for (const warning of session.skillCatalog.warnings) process.stderr.write(renderNotice(warning, "warning"));

    while (true) {
      let prompt: string;
      try {
        prompt = await ask(renderInputPrompt());
      } catch {
        break;
      }

      const text = prompt.trim();
      if (!text) continue;
      if (text === "/quit" || text === "/exit") break;
      if (text === "/help") {
        renderHelp();
        continue;
      }

      const skillsCommand = parseSkillsCommand(text);
      if (skillsCommand !== undefined) {
        renderSkillCatalog(session.skillCatalog.skills, skillsCommand, session.skillCatalog.warnings);
        continue;
      }

      const invocation = parseSkillInvocation(text);
      let inputText = text;
      if (invocation) {
        try {
          const result = await actions.buildSkillInput(target, threadId, invocation.selector, invocation.request);
          inputText = result.inputText;
          process.stdout.write(`${renderNotice(`Invoking ${result.skill.provider} skill · ${result.skill.name}`)}\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(renderNotice(message, "error"));
          continue;
        }
      }

      const completed = new Promise<void>((resolve) => { resolveCurrentTurn = resolve; });
      try {
        await actions.sendPrompt(target, threadId, inputText);
        await completed;
      } finally {
        resolveCurrentTurn = undefined;
      }
    }
  } finally {
    unsubscribe();
    reader?.close();
    await actions.disconnect(target);
  }
}

async function handleApprovalRequest(event: Extract<CodexCliEvent, { type: "commandApproval" | "fileApproval" }>, actions: CodexResumeActions, ask: Ask): Promise<void> {
  if (event.type === "commandApproval") {
    process.stderr.write(`\n${renderNotice(`Codex requests permission to run a command${event.reason ? `: ${event.reason}` : ""}`, "warning")}`);
    if (event.command !== "(unavailable)") process.stderr.write(renderActivity("COMMAND", event.command));
    if (event.cwd) process.stderr.write(`  in ${sanitizeTerminalChunk(event.cwd)}\n`);
    const answer = await ask(renderQuestionPrompt("Allow once [y], for this session [s], or decline [n]?"));
    const decision = approvalDecision(answer);
    await actions.answerApproval(event.target, event.requestId, decision);
    if (event.itemId) process.stderr.write(`[Command approval: ${decision}]\n`);
    return;
  }

  if (event.type === "fileApproval") {
    process.stderr.write(`\n${renderNotice(`Codex requests permission to apply file changes${event.reason ? `: ${event.reason}` : ""}`, "warning")}`);
    if (event.itemId) process.stderr.write(`  Item: ${sanitizeTerminalChunk(event.itemId)}\n`);
    const answer = await ask(renderQuestionPrompt("Apply once [y], for this session [s], or decline [n]?"));
    await actions.answerApproval(event.target, event.requestId, approvalDecision(answer));
  }
}

function approvalDecision(answer: string): "accept" | "acceptForSession" | "decline" {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") return "accept";
  if (normalized === "s" || normalized === "session") return "acceptForSession";
  return "decline";
}

function parseSkillsCommand(text: string): string | undefined {
  const match = text.match(/^\/skills(?:\s+([\s\S]*))?$/i);
  return match ? (match[1] ?? "") : undefined;
}

function parseSkillInvocation(text: string): SkillInvocation | undefined {
  const match = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/i);
  if (!match?.[1]) return undefined;
  return { selector: match[1], request: match[2]?.trim() ?? "" };
}
