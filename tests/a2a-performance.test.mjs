import assert from "node:assert/strict";
import { test } from "node:test";
import { HiveSessionAgentAdapter, encodeHiveSessionAddress } from "../dist/adapters/providers/hive-session-agent.js";
import { A2AHttpServer } from "../dist/adapters/transport/a2a-http-server.js";
import { injectHiveA2AMcpServer } from "../dist/adapters/providers/opencode/a2a-mcp-config.js";
import { createKiroA2AMcpServers } from "../dist/adapters/providers/kiro/a2a-mcp-server.js";
import { InMemoryA2ARuntimeStateStore } from "../dist/adapters/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/adapters/workspace/a2a-locks.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { ConfiguredCliAgentAdapter } from "../dist/adapters/providers/configured-cli-agent.js";
import { CodexAppServerApi } from "../dist/adapters/providers/codex/app-server.js";
import { CodexSessionCatalogAdapter } from "../dist/adapters/providers/codex/session-catalog.js";
import { CodexSessionTurnAdapter } from "../dist/adapters/providers/codex/session-turns.js";
import { codexAppServerArgs } from "../dist/adapters/transport/codex-process-transport.js";
import { OpenCodeTurnAdapter } from "../dist/adapters/providers/opencode/session-turns.js";
import { KiroSessionTurnAdapter } from "../dist/adapters/providers/kiro/session-turns.js";
import { providerPromptTranscript } from "../dist/adapters/providers/a2a-prompt-context.js";
import { isA2ARuntimeSnapshot } from "../dist/domain/a2a.js";

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
  assert.match(submittedPrompt.a2aCommunications[0].message, /sends are async, do not wait or poll for results/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /callerAgentId=worker/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /answer and deliver it with a2a_send to a chosen existing\/new agent using responseForTaskId=task-1/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /Accepted delivery succeeds; finish without waiting/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /callbackForTaskId=task-1/);

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
  assert.match(submittedPrompt.a2aCommunications[0].message, /forward with responseForTaskId=callback-task or finish/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /do not send another callback/i);
  assert.match(submittedPrompt.a2aCommunications[0].message, /Do not wait for accepted sends/);

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
  assert.match(submittedPrompt.a2aCommunications[0].message, /A2A response from responder for task original-task/);
  assert.match(submittedPrompt.a2aCommunications[0].message, /forward with responseForTaskId=response-task, return to sender with callbackForTaskId=response-task, or finish/);

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
  assert.match(submittedPrompt.a2aCommunications[0].message, /callbackForTaskId=bonded-task/);
  assert.doesNotMatch(submittedPrompt.a2aCommunications[0].message, /responseForTaskId=bonded-task|a2a_wait_task/i);

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

test("legacy direct wait releases workspace locks while a parent explicitly waits", async () => {
  const stateStore = new InMemoryA2ARuntimeStateStore();
  const summaries = [];
  const sessionAgentIds = new Map();
  let runtime;
  const adapter = {
    adapterId: "nested-test",
    provider: "codex",
    integrationStatus: "VERIFIED",
    permissionHandling: "preserve-target",
    capabilities: {
      discoverSessions: true,
      attachExistingProcess: false,
      resumeSession: true,
      persistentContext: true,
      structuredOutput: true,
      streaming: false,
      cancellation: true,
      toolCalling: true,
      fileAccess: false,
      shellAccess: false,
      delegation: true,
      concurrentTasks: false,
    },
    evidence: { source: "hive-provider-port", verifiedAt: "2026-09-29", confidence: "high", limitations: [] },
    async discoverSessions() { return []; },
    async isAvailable() { return true; },
    matchesNativeTarget(_session, target) { return target === "local"; },
    getPromptAddress(session) { return { target: "local", threadId: session.sessionId }; },
    async resume(session, input) {
      const agentId = sessionAgentIds.get(session.sessionId);
      assert.ok(agentId);
      if (input.task.metadata?.delivery === "a2a-result-callback" || input.task.metadata?.delivery === "a2a-result-delivery") {
        return { taskId: input.task.taskId, agentId, status: "COMPLETED", message: "The response recipient chose to finish." };
      }
      if (agentId === "caller") {
        await runtime.sendFromAgent(agentId, {
          targetAgent: "agent-2",
          callbackForTaskId: input.task.taskId,
          message: "차표",
        });
        return { taskId: input.task.taskId, agentId, status: "COMPLETED", message: "차표" };
      }
      const targetAgent = agentId === "agent-1" ? "agent-2" : "caller";
      const child = await runtime.sendFromAgent(agentId, {
        targetAgent,
        message: agentId === "agent-1" ? "Agent 2에 다음 단어를 물어봐." : "현재 세션의 다음 단어를 물어봐.",
      });
      const childResult = await runtime.waitForTask(child.task.taskId, 5_000);
      assert.equal(childResult.completed, true);
      assert.equal(childResult.state, "COMPLETED");
      if (agentId === "agent-2") {
        await runtime.sendFromAgent(agentId, {
          targetAgent: "agent-1",
          callbackForTaskId: input.task.taskId,
          message: childResult.result.message,
        });
      } else if (agentId === "agent-1" && input.task.metadata?.delivery === "a2a-async-request") {
        await runtime.sendFromAgent(agentId, {
          targetAgent: "caller",
          callbackForTaskId: input.task.taskId,
          message: childResult.result.message,
        });
      }
      return { taskId: input.task.taskId, agentId, status: "COMPLETED", message: `다음 단어: ${childResult.result.message}` };
    },
    async execute() { throw new Error("unexpected execute"); },
    async cancel() {},
  };
  runtime = new A2ARuntime({
    adapters: [adapter],
    stateStore,
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    createId: (() => { let sequence = 0; return (kind) => `${kind}-${++sequence}`; })(),
    now: () => Date.now(),
    publishAssistantEvent(event) { summaries.push(event); },
  });
  await runtime.initialize();
  await runtime.createRoom("room", "test");
  for (const agentId of ["caller", "agent-1", "agent-2"]) {
    const sessionId = `session:${agentId}`;
    sessionAgentIds.set(sessionId, agentId);
    await runtime.registerAgent("room", {
      agentId,
      adapterId: adapter.adapterId,
      session: { sessionId, provider: "codex", sessionName: agentId, workspace: "/shared-workspace", persistenceLevel: 2, runtimeManagedHistory: false },
    });
  }

  const accepted = await runtime.sendFromAgent("caller", { targetAgent: "agent-1", message: "끝말잇기를 이어 가." });
  assert.equal(accepted.state, "QUEUED");
  const result = await runtime.waitForTask(accepted.task.taskId, 5_000);
  assert.equal(result.completed, true);
  assert.equal(result.result.message, "다음 단어: 다음 단어: 차표");

  const graph = runtime.getTaskGraph(accepted.task.taskId);
  assert.equal(graph.length, 3);
  assert.deepEqual(graph.map((record) => record.task.depth), [0, 1, 2]);
  assert.equal(graph[1].task.parentTaskId, graph[0].task.taskId);
  assert.equal(graph[2].task.parentTaskId, graph[1].task.taskId);
  const callerSummary = summaries.find((event) => event.type === "a2aCommunicationSummary" && event.threadId === "session:caller");
  assert.ok(callerSummary);
  assert.equal(new Set(callerSummary.communications.map((communication) => communication.taskId)).size, 3);
  assert.equal(callerSummary.communications.some((communication) =>
    communication.kind === "result" && communication.message === "다음 단어: 다음 단어: 차표"), true);

  const snapshot = await stateStore.load();
  assert.equal(isA2ARuntimeSnapshot(snapshot), true, "native-session root tasks must survive runtime restoration validation");
  const restored = new A2ARuntime({
    adapters: [adapter], stateStore, workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    createId: () => "restored-id", now: () => Date.now(),
  });
  await restored.initialize();
  assert.equal(restored.getTaskGraph(accepted.task.taskId).length, 3);

  const legacySnapshot = structuredClone(snapshot);
  const legacyRoot = legacySnapshot.tasks.find((record) => record.task.taskId === accepted.task.taskId);
  legacySnapshot.tasks = [legacyRoot];
  legacyRoot.task.visitedAgents = [legacyRoot.task.sourceAgent, legacyRoot.task.targetAgent];
  assert.equal(isA2ARuntimeSnapshot(legacySnapshot), true, "the previous native-root path is accepted for migration");
  const legacyStore = new InMemoryA2ARuntimeStateStore();
  await legacyStore.save(legacySnapshot);
  const migrated = new A2ARuntime({
    adapters: [adapter], stateStore: legacyStore, workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    createId: () => "migration-id", now: () => Date.now(),
  });
  await migrated.initialize();
  const migratedSnapshot = await legacyStore.load();
  assert.equal(isA2ARuntimeSnapshot(migratedSnapshot), true);
  assert.deepEqual(migrated.getTask(accepted.task.taskId).task.visitedAgents, ["agent-1"]);
});

test("MCP source lookup uses the active A2A task when provider session detection misses it", async () => {
  let markTaskStarted;
  let releaseTask;
  const taskStarted = new Promise((resolve) => { markTaskStarted = resolve; });
  const blockedTask = new Promise((resolve) => { releaseTask = resolve; });
  let runtime;
  let callbackTask;
  const adapter = {
    adapterId: "active-source-test",
    provider: "codex",
    integrationStatus: "VERIFIED",
    permissionHandling: "preserve-target",
    capabilities: {
      discoverSessions: true,
      attachExistingProcess: false,
      resumeSession: true,
      persistentContext: true,
      structuredOutput: true,
      streaming: false,
      cancellation: true,
      toolCalling: true,
      fileAccess: false,
      shellAccess: false,
      delegation: true,
      concurrentTasks: false,
    },
    evidence: { source: "hive-provider-port", verifiedAt: "2026-09-29", confidence: "high", limitations: [] },
    async discoverSessions() { return []; },
    async isAvailable() { return true; },
    matchesNativeTarget(_session, target) { return target === "local"; },
    async isBusy() { return false; },
    async resume(session, input) {
      if (input.task.metadata?.delivery === "a2a-result-callback" || input.task.metadata?.delivery === "a2a-result-delivery") {
        return { taskId: input.task.taskId, agentId: input.task.targetAgent, status: "COMPLETED", message: "The response recipient chose to finish." };
      }
      if (session.sessionName === "active-caller") {
        markTaskStarted();
        await blockedTask;
      }
      if (session.sessionName === "worker" && input.task.metadata?.delivery === "a2a-async-request") {
        callbackTask = await runtime.sendFromAgent("worker", {
          targetAgent: "active-caller",
          callbackForTaskId: input.task.taskId,
          message: "Worker result.",
        });
      }
      return { taskId: input.task.taskId, agentId: input.task.targetAgent, status: "COMPLETED", message: session.sessionName };
    },
    async execute() { throw new Error("unexpected execute"); },
    async cancel() {},
  };
  runtime = new A2ARuntime({
    adapters: [adapter],
    stateStore: new InMemoryA2ARuntimeStateStore(),
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    createId: (() => { let sequence = 0; return (kind) => `${kind}-active-${++sequence}`; })(),
    now: () => Date.now(),
  });
  await runtime.initialize();
  await runtime.createRoom("active-room", "Active source lookup");
  for (const [agentId, sessionName] of [["active-caller", "active-caller"], ["worker", "worker"]]) {
    await runtime.registerAgent("active-room", {
      agentId,
      adapterId: adapter.adapterId,
      session: { sessionId: `thread:${agentId}`, provider: "codex", sessionName, workspace: "/shared-workspace", persistenceLevel: 2, runtimeManagedHistory: false },
    });
  }
  assert.equal(await runtime.resolveActiveAgentForTask("codex", "active-caller"), undefined);

  const root = await runtime.enqueueTask({ roomId: "active-room", targetAgent: "active-caller", message: "Hold while the provider calls A2A." });
  try {
    await taskStarted;
    const source = await runtime.resolveActiveAgentForTarget("codex", "local");
    assert.equal(source?.agentId, "active-caller");
    assert.equal((await runtime.resolveActiveAgentForTask("codex", "active-caller"))?.agentId, "active-caller");
    const child = await runtime.sendFromAgent(source.agentId, { targetAgent: "worker", message: "Nested A2A request." });
    assert.equal(child.task.parentTaskId, root.task.taskId);
  } finally {
    releaseTask();
  }
  assert.equal((await runtime.waitForTask(root.task.taskId, 5_000)).state, "COMPLETED");
  const graph = runtime.getTaskGraph(root.task.taskId);
  assert.equal(graph.length, 2);
  assert.equal(graph[1].task.parentTaskId, root.task.taskId);
  const childResult = await runtime.waitForTask(graph[1].task.taskId, 5_000);
  assert.equal(childResult.state, "COMPLETED", JSON.stringify(childResult));
  assert.ok(callbackTask);
  assert.equal((await runtime.waitForTask(callbackTask.task.taskId, 5_000)).state, "COMPLETED");
});

test("session discovery uses a room TTL and joins concurrent refreshes", async () => {
  let now = 1_000;
  let calls = 0;
  let releaseRefresh;
  let blockRefresh = false;
  const adapter = {
    adapterId: "discovery-test",
    provider: "test-provider",
    integrationStatus: "VERIFIED",
    capabilities: {
      discoverSessions: true,
      attachExistingProcess: false,
      resumeSession: false,
      persistentContext: false,
      structuredOutput: false,
      streaming: false,
      cancellation: false,
      toolCalling: false,
      fileAccess: false,
      shellAccess: false,
      delegation: false,
      concurrentTasks: false,
    },
    evidence: { source: "documented-command", verifiedAt: "2026-09-29", confidence: "high", limitations: [] },
    async discoverSessions() {
      calls += 1;
      if (blockRefresh) await new Promise((resolve) => { releaseRefresh = resolve; });
      return [];
    },
  };
  const runtime = new A2ARuntime({
    adapters: [adapter],
    stateStore: new InMemoryA2ARuntimeStateStore(),
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    createId: (kind) => `${kind}-test`,
    now: () => now,
  });
  await runtime.initialize();
  await runtime.createRoom("room", "Room");
  await runtime.discoverSessions("room");
  await runtime.ensureSessionsDiscovered("room");
  assert.equal(calls, 1);

  now += 15_001;
  blockRefresh = true;
  const first = runtime.ensureSessionsDiscovered("room");
  const second = runtime.ensureSessionsDiscovered("room");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  releaseRefresh();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
});

test("Codex A2A thread creation preserves the registered thread focus", async () => {
  const startOptions = [];
  const deleted = [];
  let supportsEphemeral = true;
  const session = {
    activeThreadId: "registered-thread",
    openedThreadIds: new Set(["registered-thread"]),
    freshThreadIds: new Set(),
    skillsByThread: new Map(),
    settingsByThread: new Map(),
    models: [],
    async unsubscribe() {},
    api: {
      async startThread(cwd, options) {
        startOptions.push(options);
        return {
          thread: { id: "a2a-task-thread", name: "Task", cwd, ...(supportsEphemeral ? { ephemeral: true } : {}) },
          cwd,
          model: "model",
        };
      },
      async deleteThread(threadId) { deleted.push(threadId); },
    },
  };
  const adapter = new CodexSessionCatalogAdapter({
    async getOrConnect() { return session; },
  });
  const created = await adapter.createThread("local", {
    cwd: "/project",
    model: "model",
    minimal: true,
    preserveActiveThread: true,
    ephemeral: true,
  });

  assert.equal(created.threadId, "a2a-task-thread");
  assert.equal(created.requiresFocusRestoreAfterDelete, false);
  assert.equal(session.activeThreadId, "registered-thread");
  assert.equal(session.openedThreadIds.has("a2a-task-thread"), true);
  assert.deepEqual(startOptions, [{ ephemeral: true }]);

  supportsEphemeral = false;
  await assert.rejects(adapter.createThread("local", {
    cwd: "/project",
    model: "model",
    minimal: true,
    preserveActiveThread: true,
    ephemeral: true,
  }), /does not support ephemeral A2A sessions/);
  assert.deepEqual(deleted, ["a2a-task-thread"]);
});

test("Codex minimal session inspection reads metadata without resuming an active writer", async () => {
  const session = {
    activeThreadId: "another-focused-thread",
    openedThreadIds: new Set(),
    freshThreadIds: new Set(),
    skillsByThread: new Map(),
    settingsByThread: new Map([["locked-thread", {
      model: "cached-model",
      effort: "medium",
      permissionProfile: "workspace-only",
      collaborationMode: "plan",
    }]]),
    models: [{ model: "default-model", displayName: "Default", description: "", defaultReasoningEffort: "", supportedReasoningEfforts: [], isDefault: true, hidden: false }],
    async unsubscribe() {},
    api: {
      async readThreadMetadata(threadId) {
        assert.equal(threadId, "locked-thread");
        return { thread: { id: threadId, name: "Locked session", cwd: "/project", model: "metadata-model", reasoningEffort: "high" } };
      },
      async resumeThread() { throw new Error("thread already has an active writer"); },
    },
  };
  const adapter = new CodexSessionCatalogAdapter({ async getOrConnect() { return session; } });

  const view = await adapter.openThread("local", "locked-thread", { includeTranscript: false, minimal: true });

  assert.equal(view.cwd, "/project");
  assert.equal(view.model, "metadata-model");
  assert.equal(view.reasoningEffort, "high");
  assert.equal(view.permissionProfile, "workspace-only");
  assert.equal(view.currentModeId, "plan");
  assert.deepEqual(view.entries, []);
  assert.equal(session.activeThreadId, "another-focused-thread");
  assert.equal(session.openedThreadIds.has("locked-thread"), false);
});

test("Codex app-server sends ephemeral only when requested", async () => {
  const requests = [];
  const api = new CodexAppServerApi({
    async request(method, params) {
      requests.push({ method, params });
      return {};
    },
  });
  await api.startThread("/project", { ephemeral: true });
  await api.startThread("/project");

  assert.deepEqual(requests, [
    { method: "thread/start", params: { cwd: "/project", ephemeral: true } },
    { method: "thread/start", params: { cwd: "/project" } },
  ]);
});

test("Codex app-server receives the authenticated Hive A2A MCP configuration", () => {
  const previousUrl = process.env.HIVE_A2A_MCP_URL;
  const previousToken = process.env.HIVE_A2A_HTTP_TOKEN;
  const previousEnabled = process.env.HIVE_A2A_HTTP_ENABLED;
  try {
    process.env.HIVE_A2A_MCP_URL = "http://127.0.0.1:4760/mcp?existing=1";
    process.env.HIVE_A2A_HTTP_TOKEN = "x".repeat(32);
    delete process.env.HIVE_A2A_HTTP_ENABLED;
    const args = codexAppServerArgs("local");
    assert.equal(args[0], "app-server");
    assert.equal(args.includes("experimental_use_rmcp_client=true"), false);
    assert.ok(args.includes('mcp_servers.hive_a2a.url="http://127.0.0.1:4760/mcp?existing=1&provider=codex&target=local"'));
    assert.ok(args.includes('mcp_servers.hive_a2a.bearer_token_env_var="HIVE_A2A_HTTP_TOKEN"'));
    assert.ok(args.includes("mcp_servers.hive_a2a.enabled=true"));

    process.env.HIVE_A2A_HTTP_ENABLED = "false";
    assert.deepEqual(codexAppServerArgs("local"), ["app-server"]);
  } finally {
    restoreEnvironmentValue("HIVE_A2A_MCP_URL", previousUrl);
    restoreEnvironmentValue("HIVE_A2A_HTTP_TOKEN", previousToken);
    restoreEnvironmentValue("HIVE_A2A_HTTP_ENABLED", previousEnabled);
  }
});

test("MCP a2a_send acknowledgement omits the full task and request", async () => {
  const longMessage = "private delegated request ".repeat(100);
  let submittedInput;
  const runtime = {
    async resolveActiveAgentForTarget() { return { agentId: "caller" }; },
    async sendFromAgent(_agentId, input) {
      submittedInput = input;
      return { task: { taskId: "task-accepted", message: longMessage }, state: "QUEUED" };
    },
  };
  const server = new A2AHttpServer(runtime, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "x".repeat(32),
  });
  const result = await server.callMcpTool(
    { name: "a2a_send", arguments: { targetAgent: "worker", message: longMessage, responseForTaskId: "task-origin" } },
    new URL("http://localhost/mcp?provider=codex&target=local"),
    { headers: {} },
  );
  const text = result.content[0].text;
  assert.deepEqual(JSON.parse(text), { accepted: true, taskId: "task-accepted", state: "QUEUED" });
  assert.equal(text.includes(longMessage), false);
  assert.ok(Buffer.byteLength(text, "utf8") < 256, "acknowledgement remains small even for a long request");
  assert.equal(submittedInput.responseForTaskId, "task-origin");
});

test("MCP falls back to the unique active provider session when client session metadata is unmapped", async () => {
  let activeLookupCalls = 0;
  let submittedBy;
  const runtime = {
    async resolveNativeSessionAgent(provider, nativeSessionId) {
      assert.equal(provider, "codex");
      assert.equal(nativeSessionId, "mcp-session-id");
      return undefined;
    },
    async resolveActiveAgentForTarget(provider, target) {
      activeLookupCalls += 1;
      assert.equal(provider, "codex");
      assert.equal(target, "hive-local://");
      return { agentId: "active-caller" };
    },
    async sendFromAgent(agentId) {
      submittedBy = agentId;
      return { task: { taskId: "task-fallback" }, state: "QUEUED" };
    },
  };
  const server = new A2AHttpServer(runtime, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "x".repeat(32),
  });
  await server.callMcpTool(
    { name: "a2a_send", _meta: { sessionID: "mcp-session-id" }, arguments: { targetAgent: "worker", message: "다음 단어를 물어봐." } },
    new URL("http://localhost/mcp?provider=codex&target=hive-local%3A%2F%2F"),
    { headers: {} },
  );
  assert.equal(activeLookupCalls, 1);
  assert.equal(submittedBy, "active-caller");
});

test("MCP resolves a callerAgentId only through its active runtime task", async () => {
  let submittedBy;
  const runtime = {
    async resolveNativeSessionAgent() { return undefined; },
    async resolveActiveAgentForTask(provider, agentId) {
      assert.equal(provider, "codex");
      assert.equal(agentId, "active-caller");
      return { agentId };
    },
    async resolveActiveAgentForTarget() { assert.fail("the verified task hint should resolve the source first"); },
    async sendFromAgent(agentId) {
      submittedBy = agentId;
      return { task: { taskId: "task-hinted" }, state: "QUEUED" };
    },
  };
  const server = new A2AHttpServer(runtime, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "x".repeat(32),
  });
  const result = await server.callMcpTool(
    { name: "a2a_send", _meta: { sessionID: "unmapped-session" }, arguments: {
      callerAgentId: "active-caller", targetAgent: "worker", message: "다음 단어를 물어봐.",
    } },
    new URL("http://localhost/mcp?provider=codex&target=hive-local%3A%2F%2F"),
    { headers: {} },
  );
  assert.equal(submittedBy, "active-caller");
  assert.deepEqual(JSON.parse(result.content[0].text), { accepted: true, taskId: "task-hinted", state: "QUEUED" });
});

test("MCP rejects an inactive callerAgentId instead of falling back to another active session", async () => {
  const runtime = {
    async resolveNativeSessionAgent() { return undefined; },
    async resolveActiveAgentForTask() { return undefined; },
    async resolveActiveAgentForTarget() { assert.fail("an invalid caller hint must not fall back to provider target"); },
  };
  const server = new A2AHttpServer(runtime, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "x".repeat(32),
  });
  await assert.rejects(() => server.callMcpTool(
    { name: "a2a_list_agents", arguments: { callerAgentId: "inactive-agent" } },
    new URL("http://localhost/mcp?provider=codex&target=hive-local%3A%2F%2F"),
    { headers: {} },
  ), /callerAgentId does not identify exactly one active Hive A2A task/);
});

test("MCP a2a_wait_task returns the completed result without exposing the stored request", async () => {
  const runtime = {
    async waitForTask(taskId, waitMs) {
      assert.equal(taskId, "task-ready");
      assert.equal(waitMs, 1000);
      return { completed: true, taskId, state: "COMPLETED", result: { status: "COMPLETED", message: "자동차" } };
    },
  };
  const server = new A2AHttpServer(runtime, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "x".repeat(32),
  });
  const result = await server.callMcpTool(
    { name: "a2a_wait_task", arguments: { taskId: "task-ready", waitMs: 1000 } },
    new URL("http://localhost/mcp"),
    { headers: {} },
  );
  assert.deepEqual(JSON.parse(result.content[0].text), {
    completed: true,
    taskId: "task-ready",
    state: "COMPLETED",
    result: { status: "COMPLETED", message: "자동차" },
  });
});

test("MCP tools/list advertises asynchronous A2A and A2B tools without a wait tool", async () => {
  const server = new A2AHttpServer({}, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "x".repeat(32),
  });
  try {
    await server.listen();
    const address = server.server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"x".repeat(32)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(response.status, 200);
    const packet = await response.json();
    assert.deepEqual(packet.result.tools.map((tool) => tool.name), ["a2a_list_agents", "a2a_send", "a2b_send"]);
    assert.equal(packet.result.tools.find((tool) => tool.name === "a2a_list_agents").inputSchema.properties.callerAgentId.type, "string");
    assert.equal(packet.result.tools.find((tool) => tool.name === "a2a_send").inputSchema.properties.callerAgentId.type, "string");
    assert.equal(packet.result.tools.find((tool) => tool.name === "a2a_send").inputSchema.properties.responseForTaskId.type, "string");
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_send").description, /Acceptance confirms delivery, not completion/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_send").description, /forward, return once to the sender with callbackForTaskId, or finish/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_send").description, /cannot callback again/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_send").description, /Do not wait or poll/);
  } finally {
    await server.close();
  }
});

test("OpenCode grants only the asynchronous A2A and A2B tools", () => {
  const environment = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      mcp: { servers: { existing: { type: "local", command: "agent" } } },
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
    }),
  };
  injectHiveA2AMcpServer(environment, "http://127.0.0.1:4760/mcp", "x".repeat(32));
  const config = JSON.parse(environment.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.mcp.servers.existing.command, "agent");
  assert.equal(config.mcp.servers.hivea2a.url, "http://127.0.0.1:4760/mcp");
  assert.deepEqual(
    config.permissions.filter((permission) => permission.action.startsWith("hivea2a_")),
    [
      { action: "hivea2a_a2a_send", resource: "*", effect: "allow" },
      { action: "hivea2a_a2b_send", resource: "*", effect: "allow" },
      { action: "hivea2a_a2a_list_agents", resource: "*", effect: "allow" },
    ],
  );
});

test("Kiro receives an authenticated Hive A2A MCP descriptor for its local session", () => {
  const savedEnvironment = Object.fromEntries(["HIVE_A2A_HTTP_ENABLED", "HIVE_A2A_HTTP_TOKEN", "HIVE_A2A_MCP_URL"]
    .map((name) => [name, process.env[name]]));
  try {
    process.env.HIVE_A2A_HTTP_ENABLED = "true";
    process.env.HIVE_A2A_HTTP_TOKEN = "x".repeat(32);
    process.env.HIVE_A2A_MCP_URL = "http://127.0.0.1:4760/mcp";
    const [server] = createKiroA2AMcpServers("hive-local://");
    assert.equal(server.name, "hive-a2a");
    const environment = Object.fromEntries(server.env.map(({ name, value }) => [name, value]));
    assert.equal(environment.HIVE_A2A_MCP_URL, "http://127.0.0.1:4760/mcp?provider=kiro&target=hive-local%3A%2F%2F");
    assert.equal(environment.HIVE_A2A_HTTP_TOKEN, "x".repeat(32));
    assert.equal(environment.HIVE_A2A_PROVIDER, "kiro");
    assert.equal(environment.HIVE_A2A_TARGET, "hive-local://");
  } finally {
    for (const [name, value] of Object.entries(savedEnvironment)) restoreEnvironmentValue(name, value);
  }
});

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

test("configured CLI agents receive no prior A2A history or room roster", async () => {
  const adapter = new ConfiguredCliAgentAdapter({
    adapterId: "cli-test",
    provider: "custom",
    command: "/bin/cat",
    args: [],
    sessions: [{ sessionId: "cli-session", persistenceLevel: 0, runtimeManagedHistory: false }],
    promptDelivery: "stdin",
    stdinFormat: "json",
    outputFormat: "text",
    capabilities: { toolCalling: false, fileAccess: true, shellAccess: true },
    integrationStatus: "VERIFIED",
    evidence: { source: "official-cli", verifiedAt: "2026-09-29", confidence: "high", limitations: [] },
  });
  const result = await adapter.execute({
    sessionId: "cli-session",
    provider: "custom",
    persistenceLevel: 0,
    runtimeManagedHistory: false,
  }, {
    taskId: "cli-task",
    rootTaskId: "cli-task",
    roomId: "room",
    sourceAgent: "orchestrator",
    targetAgent: "cli-agent",
    type: "REQUEST",
    message: "Inspect the parser.",
    depth: 0,
    maxDepth: 4,
    timeoutMs: 5_000,
    createdAt: 1,
    visitedAgents: ["cli-agent"],
  }, {
    signal: new AbortController().signal,
    history: [{ role: "user", message: "OLD PRIVATE HISTORY" }],
    agents: [{ agentId: "other-agent", sessionName: "Other private session" }],
    async delegate() { throw new Error("unused"); },
  });
  const payload = JSON.parse(result.message);
  assert.deepEqual(payload.history, []);
  assert.match(payload.message, /Inspect the parser/);
  assert.doesNotMatch(payload.message, /OLD PRIVATE HISTORY|Other private session/);
});

test("configured CLI delegation preserves A2A response delivery and bonded A2B rules", async () => {
  async function run(task, delegation) {
    const script = [
      'let input="";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", chunk => input += chunk);',
      `process.stdin.on("end", () => { const payload = JSON.parse(input); process.stdout.write(JSON.stringify({ message: payload.message, delegations: ${JSON.stringify([delegation])} })); });`,
    ].join("");
    const adapter = new ConfiguredCliAgentAdapter({
      adapterId: "cli-delegation-test",
      provider: "custom",
      command: process.execPath,
      args: ["-e", script],
      sessions: [{ sessionId: "cli-session", persistenceLevel: 0, runtimeManagedHistory: false }],
      promptDelivery: "stdin",
      stdinFormat: "json",
      outputFormat: "json",
      delegation: { maxCallsPerTask: 1 },
      capabilities: { toolCalling: true, fileAccess: true, shellAccess: true },
      integrationStatus: "VERIFIED",
      evidence: { source: "official-cli", verifiedAt: "2026-09-29", confidence: "high", limitations: [] },
    });
    let delegated;
    const result = await adapter.execute({
      sessionId: "cli-session",
      provider: "custom",
      persistenceLevel: 0,
      runtimeManagedHistory: false,
    }, task, {
      signal: new AbortController().signal,
      history: [{ role: "user", message: "OLD PRIVATE HISTORY" }],
      agents: [{ agentId: "private-agent", sessionName: "Private room roster" }],
      async delegate(request) { delegated = request; return { task: { taskId: "accepted" } }; },
    });
    return { prompt: result.message, delegated };
  }

  const a2a = await run({
    taskId: "cli-a2a-task", rootTaskId: "cli-a2a-task", roomId: "room", sourceAgent: "caller", targetAgent: "cli-agent",
    type: "REQUEST", message: "Inspect only this module.", depth: 0, maxDepth: 4, timeoutMs: 5_000, createdAt: 1,
    visitedAgents: ["cli-agent"], metadata: { delivery: "a2a-async-request" },
  }, {
    targetSessionName: "Result reviewer", message: "The parser rejects malformed input.", responseForTaskId: "cli-a2a-task",
  });
  assert.equal(a2a.delegated.responseForTaskId, "cli-a2a-task");
  assert.match(a2a.prompt, /deliver your answer in an async delegation with responseForTaskId=cli-a2a-task/);
  assert.match(a2a.prompt, /Accepted delivery is success; do not wait for the recipient/);
  assert.doesNotMatch(a2a.prompt, /OLD PRIVATE HISTORY|Private room roster/);

  const a2b = await run({
    taskId: "cli-bonded-task", rootTaskId: "cli-bonded-task", roomId: "room", sourceAgent: "caller", targetAgent: "bonded-agent",
    type: "REQUEST", message: "Answer this directly.", depth: 0, maxDepth: 4, timeoutMs: 5_000, createdAt: 2,
    visitedAgents: ["bonded-agent"], metadata: { delivery: "a2b-bonded-request" },
  }, { targetAgent: "caller", message: "The answer is 42.", callbackForTaskId: "cli-bonded-task" });
  assert.equal(a2b.delegated.callbackForTaskId, "cli-bonded-task");
  assert.match(a2b.prompt, /Bonded A2B: answer directly as this agent; do not delegate/);
  assert.match(a2b.prompt, /callbackForTaskId=cli-bonded-task/);
});

function restoreEnvironmentValue(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
