import assert from "node:assert/strict";
import { test } from "node:test";
import { HiveSessionAgentAdapter } from "../dist/infrastructure/providers/hive-session-agent.js";
import { encodeHiveSessionAddress } from "../dist/infrastructure/providers/hive-session-agent-address.js";

test("Hive A2A task runs in a fresh provider thread and carries no old chat context", async () => {
  const handlers = new Set();
  const emitted = [];
  const deleted = [];
  const settingUpdates = [];
  const openedThreads = [];
  let failNextOpenThread = false;
  const owner = { target: "local", threadId: "user-thread" };
  const session = {
    sessionId: encodeHiveSessionAddress(owner),
    provider: "codex",
    workspace: "/project",
    persistenceLevel: 2,
    runtimeManagedHistory: false,
  };
  const currentView = {
    target: owner.target,
    threadId: owner.threadId,
    title: "User conversation",
    cwd: "/project",
    entries: [],
    skills: [],
    skillWarnings: [],
    model: "model-current",
    reasoningEffort: "high",
    permissionProfile: "workspace-only",
    currentModeId: "plan",
  };
  const createdView = {
    ...currentView,
    threadId: "a2a-temp-thread",
    requiresFocusRestoreAfterDelete: false,
    title: "Temporary task",
    model: "model-default",
    reasoningEffort: null,
    permissionProfile: "unrestricted",
    currentModeId: null,
    thread: { id: "a2a-temp-thread", title: "Temporary task", cwd: "/project", preview: "", updatedAt: 1, provider: "codex" },
  };
  const conversations = {
    async openThread(target, threadId, options) {
      openedThreads.push(threadId);
      if (failNextOpenThread) {
        failNextOpenThread = false;
        throw new Error("raw provider response detail");
      }
      assert.equal(options.includeTranscript, false);
      assert.equal(options.minimal, true);
      assert.equal(target, owner.target);
      if (threadId === owner.threadId) return currentView;
      if (threadId === "a2a-temp-thread") return createdView;
      assert.fail(`unexpected thread inspection: ${threadId}`);
    },
    async createThread(target, input) {
      assert.equal(target, owner.target);
      assert.equal(input.cwd, "/project");
      assert.equal(input.model, "model-current");
      assert.equal(input.minimal, true);
      assert.equal(input.preserveActiveThread, true);
      assert.equal(input.ephemeral, true);
      return createdView;
    },
  };
  let adapter;
  let submittedPrompt;
  const turns = {
    async assertPromptReady() {},
    async sendPrompt(target, threadId, prompt) {
      assert.equal(target, owner.target);
      assert.equal(threadId, "a2a-temp-thread");
      submittedPrompt = prompt;
      const taskId = prompt.a2aCommunications[0].taskId;
      const turnId = `turn-${taskId}`;
      assert.equal(adapter.matchesNativeSession(session, threadId), true);
      assert.equal(adapter.getActiveTaskIdForSession(session, threadId), taskId);
      assert.equal(adapter.getActiveTaskIdForSession(session, owner.threadId), undefined);
      assert.equal(await adapter.isBusy(session), true);
      assert.deepEqual(await adapter.getPermissionProfile(session, { taskId, targetAgent: "worker" }), {
        provider: "codex",
        profile: "unrestricted",
      }, "permission lookup follows the active ephemeral task thread instead of reopening its owner");
      const discovered = await adapter.discoverSessions();
      assert.equal(discovered.some((candidate) => candidate.sessionId === encodeHiveSessionAddress({ target, threadId })), false);
      for (const handler of handlers) {
        handler({ type: "turnStarted", provider: "codex", target, threadId, turnId });
        handler({ type: "assistantMessageCompleted", provider: "codex", target, threadId, turnId, messageId: `message-${taskId}`, text: "A2A result" });
        handler({ type: "turnCompleted", provider: "codex", target, threadId, turnId, status: "completed" });
      }
      return { accepted: true, turnId };
    },
    async interruptTurn() { return { interrupted: true }; },
  };
  adapter = new HiveSessionAgentAdapter({
    adapterId: "codex-test",
    provider: "codex",
    targets: [owner.target],
    catalog: { async connect() { return { threads: [
      { id: owner.threadId, title: "User conversation", cwd: "/project", provider: "codex" },
      { id: "a2a-temp-thread", title: "Temporary task", cwd: "/project", provider: "codex" },
    ] }; } },
    conversations,
    sessions: { async deleteThread(_target, threadId) { deleted.push(threadId); } },
    settings: { async updateThreadSettings(_target, threadId, settings) {
      settingUpdates.push({ threadId, settings });
      return { updated: true };
    } },
    isPermissionProfileSupported: (profile) => profile === "workspace-only" || profile === "unrestricted",
    turns,
    subscribe(handler) { handlers.add(handler); return () => handlers.delete(handler); },
    publishEvent(event) { emitted.push(event); },
    delegationAvailable: true,
  });

  const result = await adapter.resume(session, {
    task: {
      taskId: "task-1",
      targetAgent: "worker",
      sourceAgent: "orchestrator",
      depth: 0,
      maxDepth: 4,
      visitedAgents: [],
      metadata: { delivery: "a2a-async-request" },
    },
    message: "Inspect the current module and fix its parser.",
  }, {
    signal: new AbortController().signal,
    history: Array.from({ length: 100 }, (_, index) => ({
      role: "user",
      message: `OLD PRIVATE HISTORY ${index} `.repeat(100),
    })),
    agents: Array.from({ length: 100 }, (_, index) => ({
      agentId: `other-agent-${index}`,
      sessionName: `Other private session ${index}`,
    })),
    async delegate() { throw new Error("unused"); },
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.message, "A2A result");
  assert.equal(submittedPrompt.cwd, "/project");
  assert.equal(submittedPrompt.text, "");
  assert.match(submittedPrompt.a2aCommunications[0].message, /Inspect the current module and fix its parser/);
  assert.doesNotMatch(submittedPrompt.a2aCommunications[0].message, /OLD PRIVATE HISTORY|Other private session/);
  assert.ok(Buffer.byteLength(submittedPrompt.a2aCommunications[0].message, "utf8") < 1_000,
    "task prompt size stays bounded by the request instead of inheriting old history or the room roster");
  assert.deepEqual(settingUpdates, [{
    threadId: "a2a-temp-thread",
    settings: { model: "model-current", effort: "high", permissionProfile: "workspace-only", modeId: "plan" },
  }]);
  assert.deepEqual(deleted, ["a2a-temp-thread"]);
  assert.deepEqual(openedThreads, ["user-thread", "a2a-temp-thread"], "permission lookup reads the active task thread and cleanup does not reopen the original");
  assert.equal(emitted.some((event) => event.type === "a2aCommunicationSummary" && event.threadId === owner.threadId), true);
  assert.equal(emitted.some((event) => event.type === "a2aCommunicationSummary" && event.responseTurnId), false);
  assert.deepEqual(emitted.filter((event) => event.type === "a2aCommunicationSummary").map((event) => event.communications[0].kind), ["request", "result"]);
  assert.doesNotMatch(submittedPrompt.a2aCommunications[0].message, /a2a_wait_task/i);
  assert.match(submittedPrompt.a2aCommunications[0].message, /call a2a_list/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /a2a_reply\(replyToTaskId=task-1, message\)/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /callerAgentId=worker/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /Hive sends it to the sender/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /To forward a result, use a2a_send\(targetAgent, message, replyToTaskId=task-1\)/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /Do not wait or poll/);

  await adapter.resume(session, {
    task: {
      taskId: "callback-task",
      targetAgent: "worker",
      sourceAgent: "responder",
      depth: 0,
      maxDepth: 4,
      visitedAgents: [],
      metadata: { delivery: "a2a-result-callback", callbackForTaskId: "original-task" },
    },
    message: "Original request: inspect parser. Result: malformed input accepted.",
  }, {
    signal: new AbortController().signal,
    history: [],
    agents: [],
    async delegate() { throw new Error("unused"); },
  });
  assert.match(submittedPrompt.a2aCommunications[0].message, /A2A result from responder: use a2a_reply\(replyToTaskId=callback-task, message\) to reply to the sender/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /or finish/);

  await adapter.resume(session, {
    task: {
      taskId: "response-task",
      targetAgent: "worker",
      sourceAgent: "responder",
      depth: 1,
      maxDepth: 4,
      visitedAgents: ["worker"],
      metadata: { delivery: "a2a-result-delivery", responseForTaskId: "original-task" },
    },
    message: "A2A result: malformed input is accepted.",
  }, {
    signal: new AbortController().signal,
    history: [],
    agents: [],
    async delegate() { throw new Error("unused"); },
  });
  assert.match(submittedPrompt.a2aCommunications[0].message, /A2A result from responder:/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /a2a_reply\(replyToTaskId=response-task, message\) to reply to the sender/);

  await adapter.resume(session, {
    task: {
      taskId: "bonded-task",
      targetAgent: "worker",
      sourceAgent: "bonded-caller",
      depth: 0,
      maxDepth: 4,
      visitedAgents: [],
      metadata: { delivery: "a2b-bonded-request" },
    },
    message: "Summarize the parser behavior.",
  }, {
    signal: new AbortController().signal,
    history: [],
    agents: [],
    async delegate() { throw new Error("unused"); },
  });
  assert.match(submittedPrompt.a2aCommunications[0].message, /Bonded A2B from bonded-caller: answer directly; do not delegate/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /replyToTaskId=bonded-task/);
  assert.doesNotMatch(submittedPrompt.a2aCommunications[0].message, /responseForTaskId=bonded-task|callbackForTaskId=bonded-task|a2a_wait_task/i);

  failNextOpenThread = true;
  await assert.rejects(() => adapter.resume(session, {
    task: {
      taskId: "task-2",
      targetAgent: "worker",
      sourceAgent: "orchestrator",
      depth: 0,
      maxDepth: 4,
      visitedAgents: [],
    },
    message: "Run one more isolated task.",
  }, {
    signal: new AbortController().signal,
    history: [],
    agents: [],
    async delegate() { throw new Error("unused"); },
  }), (error) => {
    assert.equal(error.code, "PROVIDER_UNAVAILABLE");
    assert.equal(error.message, "codex A2A provider failed while opening the registered session.");
    assert.doesNotMatch(error.message, /raw provider response detail/);
    return true;
  });
});
