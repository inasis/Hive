import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { A2AHttpServer } from "../dist/infrastructure/transport/a2a-http-server.js";
import { InMemoryA2ARuntimeStateStore } from "../dist/infrastructure/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/infrastructure/workspace/a2a-locks.js";
import { SystemTimerAdapter } from "../dist/infrastructure/runtime/system-timers.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { InMemoryTaskRepository } from "../dist/infrastructure/persistence/in-memory-task-repository.js";
import { InMemoryAgentRepository } from "../dist/infrastructure/persistence/in-memory-agent-repository.js";
import { InMemoryRoomRepository } from "../dist/infrastructure/persistence/in-memory-room-repository.js";
import { ensurePiA2AExtension } from "../dist/infrastructure/providers/pi/a2a-tools.js";

export const PI_AGENT_IDS = ["caller", "worker", "bonded", "other", "middle", "last"];
const piCapabilities = {
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
};

export async function createPiFixture(execute) {
  const directory = await mkdtemp(join(tmpdir(), "hive-pi-a2a-test-"));
  const oldEnvironment = saveEnvironment([
    "HIVE_A2A_HTTP_ENABLED",
    "HIVE_A2A_HTTP_TOKEN",
    "HIVE_A2A_MCP_URL",
  ]);
  const runtimeRequests = [];
  const piCalls = [];
  const runtimeEvents = [];
  const adapter = {
    adapterId: "pi-integration-test",
    provider: "pi",
    integrationStatus: "VERIFIED",
    evidence: { source: "hive-provider-port", verifiedAt: "2026-10-01", confidence: "high", limitations: [] },
    capabilities: piCapabilities,
    permissionHandling: "preserve-target",
    async discoverSessions() { return []; },
    async isAvailable() { return true; },
    canDelegate() { return true; },
    getPromptAddress(session) { return { target: "hive-local://", threadId: session.sessionId }; },
    async execute(session, task) {
      runtimeRequests.push({ provider: "pi", agentId: task.targetAgent, input: { task } });
      return execute(session, task);
    },
    async resume(session, input) {
      runtimeRequests.push({ provider: "pi", agentId: input.task.targetAgent, input });
      return execute(session, input.task);
    },
    async cancel() {},
  };
  const runtime = new A2ARuntime({
    taskRepository: new InMemoryTaskRepository(),
    agentRepository: new InMemoryAgentRepository(),
    roomRepository: new InMemoryRoomRepository(),
    adapters: [adapter],
    stateStore: new InMemoryA2ARuntimeStateStore(),
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    timers: new SystemTimerAdapter(),
    createId: (kind) => kind === "session" ? randomUUID() : `${kind}-${randomUUID()}`,
    now: () => Date.now(),
    publishAssistantEvent(event) { runtimeEvents.push(event); },
  });
  await runtime.initialize();
  await runtime.createRoom("pi-test", "Pi A2A integration test");
  for (const agentId of PI_AGENT_IDS) {
    await runtime.registerAgent("pi-test", {
      agentId,
      adapterId: adapter.adapterId,
      session: {
        sessionId: `native:${agentId}`,
        provider: "pi",
        sessionName: `Pi user session ${agentId}`,
        workspace: "/project",
        persistenceLevel: 2,
        runtimeManagedHistory: false,
      },
    });
  }

  const token = randomUUID() + randomUUID();
  const server = new A2AHttpServer(runtime, { host: "127.0.0.1", port: 0, bearerToken: token });
  try {
    await server.listen();
    const address = server.server.address();
    assert.ok(address && typeof address === "object");
    process.env.HIVE_A2A_HTTP_ENABLED = "true";
    process.env.HIVE_A2A_HTTP_TOKEN = token;
    process.env.HIVE_A2A_MCP_URL = `http://127.0.0.1:${address.port}/mcp`;
    const piAgents = await loadPiTools(directory);
    return {
      runtime,
      runtimeEvents,
      runtimeRequests,
      piCalls,
      piAgents,
      async close() {
        await server.close();
        restoreEnvironment(oldEnvironment);
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await server.close();
    restoreEnvironment(oldEnvironment);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  async function loadPiTools(root) {
    const packageDirectory = join(root, "node_modules", "typebox");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
    await writeFile(join(packageDirectory, "index.js"), `
export const Type = {
  Object: (properties, options = {}) => ({ type: "object", properties, ...options }),
  String: (options = {}) => ({ type: "string", ...options }),
  Array: (items, options = {}) => ({ type: "array", items, ...options }),
  Integer: (options = {}) => ({ type: "integer", ...options }),
  Optional: (schema) => ({ ...schema, optional: true }),
};
`);
    const extensionPath = await ensurePiA2AExtension(root);
    const createExtension = (await import(`${pathToFileURL(extensionPath).href}?${randomUUID()}`)).default;
    const piAgents = {};
    for (const agentId of PI_AGENT_IDS) {
      const tools = new Map();
      createExtension({
        registerTool(definition) { tools.set(definition.name, definition); },
      });
      assert.deepEqual([...tools.keys()].sort(), ["a2a_list", "a2a_reply", "a2a_send", "a2b_send"]);
      piAgents[agentId] = {
        async call(name, args) {
          const tool = tools.get(name);
          assert.ok(tool, `Pi did not register ${name}`);
          const context = { sessionManager: { getSessionId: () => `native:${agentId}` } };
          const response = await tool.execute(`${agentId}-${name}`, args, new AbortController().signal, () => {}, context);
          piCalls.push({ agentId, name, args });
          return response;
        },
      };
    }
    return piAgents;
  }
}

export async function assertPiA2ARoute({ name, next, expectedTargets }) {
  let piAgents;
  let rootTaskId;
  const sent = [];
  const finalTask = deferred();
  const fixture = await createPiFixture(async (_session, task) => {
    if (task.metadata?.delivery === "a2a-async-request") rootTaskId = task.taskId;
    if (task.targetAgent === "caller" && task.metadata?.delivery === "a2a-result-callback") finalTask.resolve(task);
    await next(piAgents, task, rootTaskId, sent);
    return resultFor(task, `${name} hop completed.`);
  });
  piAgents = fixture.piAgents;

  try {
    const accepted = readAcknowledgement(await piAgents.caller.call("a2a_send", {
      targetAgent: "worker", message: `Start ${name}.`,
    }));
    assert.equal(accepted.accepted, true);
    const arrived = await finalTask.promise;
    assert.equal(arrived.targetAgent, "caller");
    assert.deepEqual(fixture.runtimeRequests.map(({ input }) => input.task.targetAgent), expectedTargets);
    const flowTasks = fixture.runtimeRequests.map(({ input }) => input.task);
    assert.deepEqual(flowTasks.map((task) => task.metadata.a2aFlowDepth), expectedTargets.map((_, index) => index));
    assert.equal(new Set(flowTasks.map((task) => task.metadata.a2aFlowId)).size, 1);
    assert.equal(flowTasks.at(-1).metadata.callbackForTaskId, accepted.taskId);
    for (const task of flowTasks) {
      assert.equal((await fixture.runtime.waitForTask(task.taskId, 2_000)).state, "COMPLETED");
    }
    assert.equal(fixture.runtimeEvents.some((event) =>
      event.type === "a2aCommunicationSummary" && event.provider === "pi" && event.threadId === "native:caller"), true);
  } finally {
    await fixture.close();
  }
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

export function readAcknowledgement(result) {
  assert.equal(result.isError, undefined);
  const text = result.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

export function resultFor(task, message) {
  return { taskId: task.taskId, agentId: task.targetAgent, status: "COMPLETED", message };
}

export function saveEnvironment(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

export function restoreEnvironment(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
