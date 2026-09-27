import { createInterface } from "node:readline/promises";
import { assertSshTarget } from "./codex-rpc.js";
import { CodexAppServerApi } from "./codex-api.js";
import { discoverSkills, readPiSkill, type AvailableSkill } from "./skills.js";
import { parseHiveRelayTarget } from "./tcp-relay.js";
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
  sanitizeTerminalChunk,
  renderTurnComplete,
} from "./terminal-ui.js";

type JsonObject = Record<string, unknown>;
type Ask = (prompt: string) => Promise<string>;

/** Resume a saved thread through app-server and provide a small local chat UI. */
export async function resumeCodexThread(target: string, threadId: string): Promise<void> {
  assertSshTarget(target);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) {
    throw new Error("Thread ID contains unsupported characters");
  }
  if (!process.stdin.isTTY) {
    throw new Error("The resume command needs an interactive terminal");
  }

  const api = await CodexAppServerApi.connect(target);
  try {
    const summaryResponse = await api.readThreadMetadata(threadId);
    const summary = asObject(summaryResponse);
    const storedThread = asObject(summary?.thread);
    if (!storedThread) throw new Error("Codex returned an invalid thread/read response");
    const resumeResponse = await api.resumeThread(threadId, {
      // Keep paginated history in app-server storage instead of hydrating every
      // turn into the response. The resumed thread still retains its context.
      excludeTurns: true,
    });
    const resumedThread = asObject(asObject(resumeResponse)?.thread);
    if (!resumedThread) throw new Error("Codex returned an invalid thread/resume response");

    const remoteCwd = typeof resumedThread.cwd === "string" ? resumedThread.cwd : undefined;
    const skillCatalog = await discoverSkills(api, target, remoteCwd);
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
      completer: completerForSkills(skillCatalog.skills),
    });
    const ask: Ask = (prompt) => reader.question(prompt);
    let resolveCurrentTurn: ((params: unknown) => void) | undefined;
    let assistantOutputOpen = false;

    renderSessionHeader({
      target: targetLabel(target),
      threadId,
      ...(typeof resumedThread.name === "string" ? { title: resumedThread.name } : {}),
      ...(remoteCwd ? { cwd: remoteCwd } : {}),
      skillCount: skillCatalog.skills.length,
    });
    for (const warning of skillCatalog.warnings) {
      process.stderr.write(renderNotice(warning, "warning"));
    }

    const unsubscribe = api.onNotification((method, params, requestId) => {
      if (requestId !== undefined) {
        void handleServerRequest(api, method, params, requestId, ask).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`\n${renderNotice(`Could not answer Codex request: ${message}`, "error")}`);
          try {
            api.respondWithError(requestId, -32603, "Hive could not handle this request");
          } catch {
            // The connection may have closed while the local approval prompt was open.
          }
        });
        return;
      }

      const event = asObject(params);
      if (method === "item/started") {
        const item = asObject(event?.item);
        if (item?.type === "commandExecution") {
          process.stderr.write(`\n${renderActivity("COMMAND", displayValue(item.command))}`);
        } else if (item?.type === "fileChange") {
          process.stderr.write(`\n${renderActivity("FILE CHANGES", "Codex is preparing edits")}`);
        }
      } else if (method === "item/agentMessage/delta") {
        const delta = event?.delta;
        if (typeof delta === "string" && delta.length > 0) {
          if (!assistantOutputOpen) {
            process.stdout.write(renderAssistantStart());
            assistantOutputOpen = true;
          }
          process.stdout.write(sanitizeTerminalChunk(delta));
        }
      } else if (method === "turn/completed") {
        const turn = asObject(event?.turn);
        const status = typeof turn?.status === "string" ? turn.status : "unknown";
        if (assistantOutputOpen) process.stdout.write("\n");
        process.stdout.write(`${renderTurnComplete(status)}\n`);
        assistantOutputOpen = false;

        const failure = asObject(turn?.error);
        if (typeof failure?.message === "string") {
          process.stderr.write(renderNotice(`Codex error: ${failure.message}`, "error"));
        }
        resolveCurrentTurn?.(params);
        resolveCurrentTurn = undefined;
      } else if (method === "warning") {
        if (typeof event?.message === "string") {
          process.stderr.write(`\n${renderNotice(`Codex warning: ${event.message}`, "warning")}`);
        }
      }
    });

    try {
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
          renderSkillCatalog(skillCatalog.skills, skillsCommand, skillCatalog.warnings);
          continue;
        }

        const invocation = parseSkillInvocation(text);
        let inputText = text;
        if (invocation) {
          const resolution = resolveSkill(skillCatalog.skills, invocation.selector);
          if (resolution.error) {
            process.stderr.write(renderNotice(resolution.error, "error"));
            continue;
          }
          const skill = resolution.skill;
          if (!skill) {
            process.stderr.write(
              renderNotice(`No available skill named '${invocation.selector}'. Use /skills to browse.`, "error"),
            );
            continue;
          }
          if (!skill.enabled) {
            process.stderr.write(renderNotice(`The '${skill.name}' skill is disabled.`, "warning"));
            continue;
          }
          try {
            inputText = await buildSkillInput(target, skill, invocation.request);
            process.stdout.write(`${renderNotice(`Invoking ${skill.provider} skill · ${skill.name}`)}\n`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(renderNotice(message, "error"));
            continue;
          }
        }

        const completed = new Promise<unknown>((resolve) => {
          resolveCurrentTurn = resolve;
        });
        try {
          await api.startTurn(threadId, inputText);
          await completed;
        } finally {
          resolveCurrentTurn = undefined;
        }
      }
    } finally {
      unsubscribe();
      reader.close();
    }
  } finally {
    await api.close();
  }
}

function targetLabel(target: string): string {
  const relay = parseHiveRelayTarget(target);
  return relay
    ? (relay.tls ? "hive+tls://" : "hive+tcp://") + (relay.host.includes(":") ? "[" + relay.host + "]" : relay.host) + ":" + relay.port + "/" + relay.pairId
    : target;
}

async function handleServerRequest(
  api: CodexAppServerApi,
  method: string,
  params: unknown,
  requestId: number | string,
  ask: Ask,
): Promise<void> {
  const request = asObject(params);

  if (method === "item/commandExecution/requestApproval") {
    const command = displayValue(request?.command);
    const cwd = typeof request?.cwd === "string" ? request.cwd : undefined;
    const reason = typeof request?.reason === "string" ? request.reason : undefined;
    const itemId = typeof request?.itemId === "string" ? request.itemId : undefined;
    process.stderr.write(
      `\n${renderNotice(`Codex requests permission to run a command${reason ? `: ${reason}` : ""}`, "warning")}`,
    );
    if (command !== "(unavailable)") process.stderr.write(renderActivity("COMMAND", command));
    if (cwd) process.stderr.write(`  in ${sanitizeTerminalChunk(cwd)}\n`);
    const answer = await ask(renderQuestionPrompt("Allow once [y], for this session [s], or decline [n]?"));
    const decision = approvalDecision(answer);
    api.respondToRequest(requestId, { decision });
    if (itemId) process.stderr.write(`[Command approval: ${decision}]\n`);
    return;
  }

  if (method === "item/fileChange/requestApproval") {
    const reason = typeof request?.reason === "string" ? request.reason : undefined;
    const itemId = typeof request?.itemId === "string" ? request.itemId : undefined;
    process.stderr.write(
      `\n${renderNotice(`Codex requests permission to apply file changes${reason ? `: ${reason}` : ""}`, "warning")}`,
    );
    if (itemId) process.stderr.write(`  Item: ${sanitizeTerminalChunk(itemId)}\n`);
    const answer = await ask(renderQuestionPrompt("Apply once [y], for this session [s], or decline [n]?"));
    api.respondToRequest(requestId, { decision: approvalDecision(answer) });
    return;
  }

  if (method === "item/permissions/requestApproval") {
    process.stderr.write(
      `\n${renderNotice("Hive does not grant additional permission requests; declining them.", "warning")}`,
    );
    api.respondToRequest(requestId, { permissions: [] });
    return;
  }

  if (method === "mcpServer/elicitation/request") {
    process.stderr.write(
      `\n${renderNotice("Hive does not handle this external input request; declining it.", "warning")}`,
    );
    api.respondToRequest(requestId, { action: "decline", content: null });
    return;
  }

  api.respondWithError(requestId, -32601, `Hive does not support server request: ${method}`);
}

function approvalDecision(answer: string): "accept" | "acceptForSession" | "decline" {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") return "accept";
  if (normalized === "s" || normalized === "session") return "acceptForSession";
  return "decline";
}

type SkillInvocation = { selector: string; request: string };

function parseSkillsCommand(text: string): string | undefined {
  const match = text.match(/^\/skills(?:\s+([\s\S]*))?$/i);
  return match ? (match[1] ?? "") : undefined;
}

function parseSkillInvocation(text: string): SkillInvocation | undefined {
  const match = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/i);
  if (!match?.[1]) return undefined;
  return { selector: match[1], request: match[2]?.trim() ?? "" };
}

function resolveSkill(
  skills: AvailableSkill[],
  selector: string,
): { skill?: AvailableSkill; error?: string } {
  const [prefix, ...nameParts] = selector.split(":");
  const provider = prefix?.toLowerCase();
  const qualifiedProvider = ["codex", "pi", "shared"].includes(provider ?? "") ? provider : undefined;
  const name = qualifiedProvider ? nameParts.join(":") : selector;
  const matches = skills.filter(
    (skill) => skill.name === name && (!qualifiedProvider || skill.provider.toLowerCase() === qualifiedProvider),
  );
  if (matches.length > 1) {
    const choices = matches.map((skill) => `/skill:${skill.provider.toLowerCase()}:${skill.name}`).join("  ");
    return { error: `Skill name '${name}' is ambiguous. Choose ${choices}` };
  }
  return { ...(matches[0] ? { skill: matches[0] } : {}) };
}

async function buildSkillInput(target: string, skill: AvailableSkill, request: string): Promise<string> {
  if (skill.provider !== "Pi") {
    const prompt = skill.defaultPrompt?.trim() || `Use $${skill.name} to handle this request.`;
    return request ? `${prompt}\n\nUser request: ${request}` : prompt;
  }

  const instructions = await readPiSkill(target, skill);
  const selectedTask = request || "Apply this skill to the current session and ask me if you need more input.";
  const skillDirectory = skill.path.slice(0, skill.path.lastIndexOf("/"));
  return [
    `Use the explicitly selected Pi skill '${skill.name}'. Follow its instructions and resolve any relative skill resources from '${skillDirectory}'.`,
    "The skill remains on the remote host; Hive only sends its entrypoint for this invocation.",
    "",
    `--- BEGIN PI SKILL: ${skill.name} ---`,
    instructions,
    `--- END PI SKILL: ${skill.name} ---`,
    "",
    `User request: ${selectedTask}`,
  ].join("\n");
}

function displayValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && value.length > 0) {
    return value.map((part) => String(part)).join(" ");
  }
  return "(unavailable)";
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
