import assert from "node:assert/strict";
import { test } from "node:test";
import { A2AHttpServer } from "../dist/infrastructure/transport/a2a-http-server.js";
import { InMemoryA2ARuntimeStateStore } from "../dist/infrastructure/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/infrastructure/workspace/a2a-locks.js";
import { SystemTimerAdapter } from "../dist/infrastructure/runtime/system-timers.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { InMemoryTaskRepository } from "../dist/infrastructure/persistence/in-memory-task-repository.js";
import { InMemoryAgentRepository } from "../dist/infrastructure/persistence/in-memory-agent-repository.js";
import { InMemoryRoomRepository } from "../dist/infrastructure/persistence/in-memory-room-repository.js";
import { callMcpTool } from "./a2a-mcp-dispatch-test-support.mjs";

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
    taskRepository: new InMemoryTaskRepository(),
    agentRepository: new InMemoryAgentRepository(),
    roomRepository: new InMemoryRoomRepository(),
    adapters: [adapter],
    stateStore: new InMemoryA2ARuntimeStateStore(),
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    timers: new SystemTimerAdapter(),
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
  const result = await callMcpTool(runtime,
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
  await callMcpTool(runtime,
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
  const result = await callMcpTool(runtime,
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
  await assert.rejects(() => callMcpTool(runtime,
    { name: "a2a_list", arguments: { callerAgentId: "inactive-agent" } },
    new URL("http://localhost/mcp?provider=codex&target=hive-local%3A%2F%2F"),
    { headers: {} },
  ), /callerAgentId does not identify exactly one active Hive A2A task/);
});
