import { InMemoryA2ARuntimeStateStore } from "../dist/infrastructure/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/infrastructure/workspace/a2a-locks.js";
import { SystemTimerAdapter } from "../dist/infrastructure/runtime/system-timers.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { InMemoryTaskRepository } from "../dist/infrastructure/persistence/in-memory-task-repository.js";
import { InMemoryAgentRepository } from "../dist/infrastructure/persistence/in-memory-agent-repository.js";
import { InMemoryRoomRepository } from "../dist/infrastructure/persistence/in-memory-room-repository.js";

const capabilities = {
  discoverSessions: true,
  attachExistingProcess: false,
  resumeSession: false,
  persistentContext: false,
  structuredOutput: false,
  streaming: false,
  cancellation: true,
  toolCalling: true,
  fileAccess: false,
  shellAccess: false,
  delegation: true,
  concurrentTasks: false,
};

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function createHarness({
  agentIds = ["caller", "worker", "other"],
  provider = "custom",
  execute = async (_session, task) => ({ taskId: task.taskId, agentId: task.targetAgent, status: "COMPLETED", message: "done" }),
  createSession,
  workspace,
  promptAddress = false,
  permissionHandling = "preserve-target",
  getPermissionProfile,
  isAvailable = async () => true,
  canDelegateForSession = () => true,
  policy,
} = {}) {
  const summaries = [];
  const stateStore = new InMemoryA2ARuntimeStateStore();
  const adapter = {
    adapterId: "test-adapter",
    provider,
    integrationStatus: "VERIFIED",
    permissionHandling,
    capabilities,
    evidence: { source: "hive-provider-port", verifiedAt: "2026-09-30", confidence: "high", limitations: [] },
    async discoverSessions() { return []; },
    async isAvailable(session) { return isAvailable(session); },
    canDelegate(session) { return canDelegateForSession(session); },
    async execute(session, task, context) { return execute(session, task, context); },
    async resume(session, input, context) { return execute(session, input.task, context); },
    async getPermissionProfile(session, activeTask) { return getPermissionProfile?.(session, activeTask); },
    canInheritPermissionProfile() { return true; },
    async cancel() {},
    ...(createSession ? { createSession } : {}),
    ...(promptAddress ? { getPromptAddress(session) { return { target: "local", threadId: session.sessionId }; } } : {}),
  };
  let id = 0;
  const runtime = new A2ARuntime({
    taskRepository: new InMemoryTaskRepository(),
    agentRepository: new InMemoryAgentRepository(),
    roomRepository: new InMemoryRoomRepository(),
    adapters: [adapter],
    stateStore,
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    timers: new SystemTimerAdapter(),
    createId: (kind) => `${kind}-${++id}`,
    now: () => Date.now(),
    ...(policy ? { policy } : {}),
    publishAssistantEvent(event) { summaries.push(event); },
  });
  await runtime.initialize();
  await runtime.createRoom("room", "A2A async test");
  for (const agentId of agentIds) {
    await runtime.registerAgent("room", {
      agentId,
      adapterId: adapter.adapterId,
      session: {
        sessionId: `session:${agentId}`,
        provider,
        ...(workspace ? { workspace } : createSession ? { workspace: "/project" } : {}),
        persistenceLevel: 0,
        runtimeManagedHistory: false,
      },
    });
  }
  return { runtime, adapter, stateStore, summaries };
}

export function resultFor(task, message) {
  return { taskId: task.taskId, agentId: task.targetAgent, status: "COMPLETED", message };
}

export function waitForSignal(promise, label, inspect) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not occur: ${JSON.stringify(inspect())}`)), 1_000);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function waitForTerminal(runtime, taskId, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    let timer;
    let unsubscribe = () => {};
    const finish = (record) => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve(record);
    };
    unsubscribe = runtime.subscribe((event) => {
      if (event.type !== "task.updated" || event.task.task.taskId !== taskId) return;
      if (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(event.task.state)) finish(event.task);
    });
    timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Task ${taskId} did not finish: ${JSON.stringify(runtime.getTask(taskId))}`));
    }, timeoutMs);
    const current = runtime.getTask(taskId);
    if (current && ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(current.state)) finish(current);
  });
}

export function faultCode(error) {
  return error?.detail?.code;
}
