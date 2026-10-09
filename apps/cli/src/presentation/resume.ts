import { createInterface } from "node:readline/promises";
import type { CodexCliEvent, CodexCliOpenedSession } from "../../../../src/application/ports/codex-cli.js";
import type { SkillInputPreparation, SkillSelection } from "../../../../src/application/ports/skills.js";
import { completerForSkills, renderSkillCatalog } from "./terminal-skill-ui.js";
import {
  renderHelp,
  renderInputPrompt,
  renderNotice,
  renderSessionHeader,
} from "./terminal-ui.js";
import { parseSkillSelector } from "./skill-selector.js";
import { handleCodexApprovalRequest } from "./codex-approval-prompt.js";
import { CodexResumeEventPresenter } from "./codex-resume-event-presenter.js";

type Ask = (prompt: string) => Promise<string>;
type SkillInvocation = { selector: string; request: string };

export type CodexResumeActions = {
  validateTarget(target: string): void;
  validateThreadId(threadId: string): void;
  openSession(target: string, threadId: string): Promise<CodexCliOpenedSession>;
  buildSkillInput(target: string, threadId: string, selection: SkillSelection, request: string): Promise<SkillInputPreparation>;
  sendPrompt(target: string, threadId: string, text: string): Promise<void>;
  answerApproval(target: string, requestId: number | string, decision: "accept" | "acceptForSession" | "decline"): Promise<void>;
  subscribe(listener: (event: CodexCliEvent) => void): () => void;
  disconnect(target: string): Promise<void>;
};

/** Interactive terminal interface for resuming a Codex session through application actions. */
export async function resumeCodexThread(target: string, threadId: string, actions: CodexResumeActions): Promise<void> {
  actions.validateTarget(target);
  actions.validateThreadId(threadId);
  if (!process.stdin.isTTY) throw new Error("The resume command needs an interactive terminal");

  let reader: ReturnType<typeof createInterface> | undefined;
  const ask: Ask = (prompt) => {
    if (!reader) return Promise.reject(new Error("The Codex session prompt is not ready"));
    return reader.question(prompt);
  };
  const presenter = new CodexResumeEventPresenter();
  const unsubscribe = actions.subscribe((event) => {
    if (event.target !== target || event.threadId !== threadId) return;
    if (event.type === "commandApproval" || event.type === "fileApproval") {
      void handleCodexApprovalRequest(event, actions, ask).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`\n${renderNotice(`Could not answer Codex request: ${message}`, "error")}`);
        void actions.answerApproval(target, event.requestId!, "decline").catch(() => undefined);
      });
      return;
    }
    presenter.present(event);
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
          const result = await actions.buildSkillInput(target, threadId, parseSkillSelector(invocation.selector), invocation.request);
          if (result.status === "ready") {
            inputText = result.inputText;
            process.stdout.write(`${renderNotice(`Invoking ${result.skill.provider} skill · ${result.skill.name}`)}\n`);
          } else {
            process.stderr.write(renderNotice(skillPreparationMessage(result, invocation.selector), "error"));
            continue;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(renderNotice(message, "error"));
          continue;
        }
      }

      await presenter.sendPromptAndWait(() => actions.sendPrompt(target, threadId, inputText));
    }
  } finally {
    unsubscribe();
    reader?.close();
    await actions.disconnect(target);
  }
}

function skillPreparationMessage(result: Exclude<SkillInputPreparation, { status: "ready" }>, selector: string): string {
  if (result.status === "notFound") return `No available skill named '${selector}'. Use /skills to browse.`;
  if (result.status === "disabled") return `The '${result.skill.name}' skill is disabled.`;
  const choices = result.skills.map((skill) => `/skill:${skill.provider.toLowerCase()}:${skill.name}`).join("  ");
  return `Skill name '${result.name}' is ambiguous. Choose ${choices}`;
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
