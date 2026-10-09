import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryA2ARuntimeStateStore } from "../dist/infrastructure/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/infrastructure/workspace/a2a-locks.js";
import { SystemTimerAdapter } from "../dist/infrastructure/runtime/system-timers.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { InMemoryTaskRepository } from "../dist/infrastructure/persistence/in-memory-task-repository.js";
import { InMemoryAgentRepository } from "../dist/infrastructure/persistence/in-memory-agent-repository.js";
import { InMemoryRoomRepository } from "../dist/infrastructure/persistence/in-memory-room-repository.js";
import { ProviderConversationUseCases } from "../dist/application/use-cases/provider-conversations.js";

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
    taskRepository: new InMemoryTaskRepository(),
    agentRepository: new InMemoryAgentRepository(),
    roomRepository: new InMemoryRoomRepository(),
    adapters: [adapter],
    stateStore: new InMemoryA2ARuntimeStateStore(),
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    timers: new SystemTimerAdapter(),
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

test("creating a Hive session invalidates A2A discovery and exposes the new session immediately", async () => {
  const sessions = [{
    sessionId: "thread-first",
    provider: "codex",
    sessionName: "First session",
    persistenceLevel: 0,
    runtimeManagedHistory: false,
  }];
  let releaseInitialDiscovery;
  let initialDiscoveryStarted;
  const initialDiscoveryStartedPromise = new Promise((resolve) => { initialDiscoveryStarted = resolve; });
  let discoveryCalls = 0;
  const adapter = {
    adapterId: "session-discovery-test",
    provider: "codex",
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
    evidence: { source: "documented-command", verifiedAt: "2026-10-02", confidence: "high", limitations: [] },
    async discoverSessions() {
      discoveryCalls += 1;
      const snapshot = [...sessions];
      if (discoveryCalls === 1) {
        initialDiscoveryStarted();
        await new Promise((resolve) => { releaseInitialDiscovery = resolve; });
      }
      return snapshot;
    },
    async isAvailable() { return true; },
  };
  let id = 0;
  const runtime = new A2ARuntime({
    taskRepository: new InMemoryTaskRepository(),
    agentRepository: new InMemoryAgentRepository(),
    roomRepository: new InMemoryRoomRepository(),
    adapters: [adapter],
    stateStore: new InMemoryA2ARuntimeStateStore(),
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    timers: new SystemTimerAdapter(),
    createId: (kind) => `${kind}-${++id}`,
    now: () => 1_000,
  });
  await runtime.initialize();
  await runtime.createRoom("room", "Room");
  const initialDiscovery = runtime.discoverSessions("room");
  await initialDiscoveryStartedPromise;
  const createdThread = {
    threadId: "thread-later",
    thread: { id: "thread-later", title: "New Hive session", cwd: "/workspace" },
  };
  const conversations = new ProviderConversationUseCases({
    codex: {
      async createThread() {
        sessions.push({
          sessionId: createdThread.threadId,
          provider: "codex",
          sessionName: "New Hive session",
          workspace: "/workspace",
          persistenceLevel: 0,
          runtimeManagedHistory: false,
        });
        return createdThread;
      },
    },
  }, undefined, () => runtime.invalidateSessionDiscovery());

  await conversations.createThread("codex", "local", { cwd: "/workspace" });
  const refreshed = runtime.ensureSessionsDiscovered("room");
  releaseInitialDiscovery();
  await Promise.all([initialDiscovery, refreshed]);

  assert.equal(discoveryCalls, 2);
  assert.deepEqual(runtime.listAgents("room").map((agent) => agent.sessionName), ["First session", "New Hive session"]);
});
