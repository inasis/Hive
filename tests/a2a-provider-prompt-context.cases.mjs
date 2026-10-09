import assert from "node:assert/strict";
import { test } from "node:test";
import { CodexSessionTurnAdapter } from "../dist/infrastructure/providers/codex/session-turns.js";
import { OpenCodeTurnAdapter } from "../dist/infrastructure/providers/opencode/session-turns.js";
import { KiroSessionTurnAdapter } from "../dist/infrastructure/providers/kiro/session-turns.js";
import { providerPromptTranscript } from "../dist/infrastructure/providers/a2a-prompt-context.js";

test("Codex, OpenCode, and Kiro turn adapters submit A2A-only internal context", async () => {
  const communication = {
    kind: "request",
    taskId: "task-provider-prompt",
    sourceAgentId: "source-agent",
    message: "Inspect only the current parser request.",
  };
  const prompts = {};

  const codexSession = {
    openedThreadIds: new Set(["task-thread"]),
    skillsByThread: new Map(),
    api: { async startTurn(_threadId, prompt) { prompts.codex = prompt; return { turn: { id: "codex-turn" } }; } },
  };
  const codex = new CodexSessionTurnAdapter({ async getOrConnect() { return codexSession; } });
  await codex.sendPrompt("hive-local://", "task-thread", { text: "", a2aCommunications: [communication] });

  const openCodeSession = {
    openedThreadIds: new Set(["task-thread"]),
    settingsByThread: new Map([["task-thread", { model: "model" }]]),
    connection: { async sendPrompt(_target, _threadId, prompt) { prompts.opencode = prompt; return "opencode-turn"; } },
  };
  const openCode = new OpenCodeTurnAdapter({ require() { return openCodeSession; } }, () => {});
  await openCode.sendPrompt("hive-local://", "task-thread", { text: "", a2aCommunications: [communication] });

  const kiroSession = {
    openedThreadIds: new Set(["task-thread"]),
    settingsByThread: new Map([["task-thread", { model: "model", effort: null }]]),
    activeTurnIds: new Map(),
    transcriptsByThread: new Map(),
    toolFailuresByThread: new Map(),
    connection: { startPrompt(_threadId, content) { prompts.kiro = content[0].text; } },
  };
  const kiro = new KiroSessionTurnAdapter({}, async () => kiroSession, () => {});
  await kiro.sendPrompt("hive-local://", "task-thread", { text: "", a2aCommunications: [communication] });

  for (const [provider, prompt] of Object.entries(prompts)) {
    const decoded = providerPromptTranscript(prompt);
    assert.equal(decoded.text, "", `${provider} keeps internal A2A context out of user-authored text`);
    assert.deepEqual(decoded.communications, [communication], `${provider} delivers the current request through Hive's internal summary`);
  }
});
