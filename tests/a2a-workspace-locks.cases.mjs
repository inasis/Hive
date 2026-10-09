import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryA2ARuntimeStateStore } from "../dist/infrastructure/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/infrastructure/workspace/a2a-locks.js";
import { SystemTimerAdapter } from "../dist/infrastructure/runtime/system-timers.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { InMemoryTaskRepository } from "../dist/infrastructure/persistence/in-memory-task-repository.js";
import { InMemoryAgentRepository } from "../dist/infrastructure/persistence/in-memory-agent-repository.js";
import { InMemoryRoomRepository } from "../dist/infrastructure/persistence/in-memory-room-repository.js";
import { isA2ARuntimeSnapshot } from "../dist/infrastructure/persistence/a2a-runtime-snapshot.js";

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
    taskRepository: new InMemoryTaskRepository(),
    agentRepository: new InMemoryAgentRepository(),
    roomRepository: new InMemoryRoomRepository(),
    adapters: [adapter],
    stateStore,
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    timers: new SystemTimerAdapter(),
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
    taskRepository: new InMemoryTaskRepository(),
    agentRepository: new InMemoryAgentRepository(),
    roomRepository: new InMemoryRoomRepository(),
    adapters: [adapter], stateStore, workspaceLocks: new InMemoryA2AWorkspaceLockManager(), timers: new SystemTimerAdapter(),
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
    taskRepository: new InMemoryTaskRepository(),
    agentRepository: new InMemoryAgentRepository(),
    roomRepository: new InMemoryRoomRepository(),
    adapters: [adapter], stateStore: legacyStore, workspaceLocks: new InMemoryA2AWorkspaceLockManager(), timers: new SystemTimerAdapter(),
    createId: () => "migration-id", now: () => Date.now(),
  });
  await migrated.initialize();
  const migratedSnapshot = await legacyStore.load();
  assert.equal(isA2ARuntimeSnapshot(migratedSnapshot), true);
  assert.deepEqual(migrated.getTask(accepted.task.taskId).task.visitedAgents, ["agent-1"]);
});
