import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { A2AHttpServer } from "../dist/infrastructure/transport/a2a-http-server.js";
import { PiSessionCatalogOperations } from "../dist/infrastructure/providers/pi/session-catalog-operations.js";
import { PiSessionConversationAdapter } from "../dist/infrastructure/providers/pi/session-conversations.js";
import { PiSessionContext } from "../dist/infrastructure/providers/pi/session-context.js";
import { PiSessionLifecycleAdapter } from "../dist/infrastructure/providers/pi/session-lifecycle.js";
import { PiThreadSettingsAdapter } from "../dist/infrastructure/providers/pi/session-settings.js";
import { PiTurnAdapter } from "../dist/infrastructure/providers/pi/session-turns.js";
import { HiveSessionAgentAdapter } from "../dist/infrastructure/providers/hive-session-agent.js";
import { encodeHiveSessionAddress } from "../dist/infrastructure/providers/hive-session-agent-address.js";
import { InMemoryA2ARuntimeStateStore } from "../dist/infrastructure/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/infrastructure/workspace/a2a-locks.js";
import { SystemTimerAdapter } from "../dist/infrastructure/runtime/system-timers.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { InMemoryTaskRepository } from "../dist/infrastructure/persistence/in-memory-task-repository.js";
import { InMemoryAgentRepository } from "../dist/infrastructure/persistence/in-memory-agent-repository.js";
import { InMemoryRoomRepository } from "../dist/infrastructure/persistence/in-memory-room-repository.js";
import { LOCAL_WORKSPACE_TARGET } from "../dist/domain/workspace.js";
import { closeServer, createFakeOpenAIModelServer, listen, saveEnvironment } from "./pi-a2a-live-test-support.mjs";

const enabled = process.env.HIVE_RUN_PI_LIVE_A2A === "1";

test("real Pi RPC sends A2A callback and rejects an A2B branch", { skip: !enabled, timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "hive-pi-live-a2a-"));
  const configDirectory = join(root, "pi-config");
  const sessionDirectory = join(root, "pi-sessions");
  const workspace = join(root, "empty-workspace");
  const wrapper = join(root, "pi-no-local-tools.sh");
  const previousEnvironment = saveEnvironment([
    "HIVE_A2A_HTTP_ENABLED", "HIVE_A2A_HTTP_TOKEN", "HIVE_A2A_MCP_URL", "HIVE_A2A_STATE_FILE",
    "HIVE_PI_BIN", "HIVE_PI_SESSION_DIR", "PI_CODING_AGENT_DIR",
  ]);
  const eventListeners = new Set();
  const providerEvents = [];
  let piContext;
  let piCatalog;
  let piConversations;
  let piTurns;
  let adapter;
  let runtime;
  let server;
  let modelServer;
  let unsubscribeTasks;
  try {
    await mkdir(configDirectory, { recursive: true, mode: 0o700 });
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await writeFile(wrapper, "#!/bin/sh\nexec pi --no-builtin-tools --no-extensions \"$@\"\n", { mode: 0o700 });
    await chmod(wrapper, 0o700);

    const modelRequests = [];
    modelServer = createFakeOpenAIModelServer(modelRequests);
    await listen(modelServer);
    const modelAddress = modelServer.address();
    assert.ok(modelAddress && typeof modelAddress === "object");
    await writeFile(join(configDirectory, "models.json"), JSON.stringify({
      providers: {
        hive_test: {
          baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
          api: "openai-completions",
          apiKey: "hive-test-only-key",
          models: [{
            id: "fixture-model",
            name: "Hive Pi A2A Fixture",
            reasoning: false,
            input: ["text"],
            contextWindow: 32_000,
            maxTokens: 1_024,
          }],
        },
      },
    }), { mode: 0o600 });

    process.env.HIVE_A2A_HTTP_ENABLED = "true";
    process.env.HIVE_A2A_HTTP_TOKEN = randomUUID() + randomUUID();
    process.env.HIVE_PI_BIN = wrapper;
    process.env.HIVE_PI_SESSION_DIR = sessionDirectory;
    process.env.PI_CODING_AGENT_DIR = configDirectory;
    delete process.env.HIVE_A2A_STATE_FILE;

    const publish = (event) => {
      providerEvents.push(event);
      for (const listener of eventListeners) listener(event);
    };
    piContext = new PiSessionContext();
    piTurns = new PiTurnAdapter(piContext, publish);
    const piOnRecord = piTurns.handleRecord.bind(piTurns);
    piCatalog = new PiSessionCatalogOperations(piContext);
    piConversations = new PiSessionConversationAdapter(piContext, piOnRecord);
    const piSessions = new PiSessionLifecycleAdapter(piContext, piOnRecord, publish);
    const piSettings = new PiThreadSettingsAdapter(piContext, piOnRecord);
    adapter = new HiveSessionAgentAdapter({
      adapterId: "pi-live-a2a-test",
      provider: "pi",
      targets: [LOCAL_WORKSPACE_TARGET],
      catalog: piCatalog,
      conversations: piConversations,
      sessions: piSessions,
      settings: piSettings,
      permissionHandling: "preserve-target",
      turns: piTurns,
      subscribe(handler) { eventListeners.add(handler); return () => eventListeners.delete(handler); },
      publishEvent: publish,
      delegationAvailable: true,
      canDelegateSession: () => true,
    });
    runtime = new A2ARuntime({
      taskRepository: new InMemoryTaskRepository(),
      agentRepository: new InMemoryAgentRepository(),
      roomRepository: new InMemoryRoomRepository(),
      adapters: [adapter],
      stateStore: new InMemoryA2ARuntimeStateStore(),
      workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
      timers: new SystemTimerAdapter(),
      createId: (kind) => `${kind}-${randomUUID()}`,
      now: () => Date.now(),
      publishAssistantEvent: publish,
    });
    await runtime.initialize();
    const roomId = "pi-live-a2a";
    await runtime.createRoom(roomId, "격리된 실제 Pi A2A 시험");
    server = new A2AHttpServer(runtime, {
      host: "127.0.0.1", port: 0, bearerToken: process.env.HIVE_A2A_HTTP_TOKEN,
    });
    await server.listen();
    const address = server.server.address();
    assert.ok(address && typeof address === "object");
    process.env.HIVE_A2A_MCP_URL = `http://127.0.0.1:${address.port}/mcp`;

    const catalog = await piCatalog.connect(LOCAL_WORKSPACE_TARGET);
    const model = catalog.models.find((entry) => !entry.hidden)?.model;
    assert.ok(model, "the isolated Pi configuration must expose a usable model");
    const sessions = new Map();
    for (const agentId of ["pi-a2a-caller", "pi-a2a-worker", "pi-a2b-caller", "pi-a2b-bonded"]) {
      const thread = await piConversations.createThread(LOCAL_WORKSPACE_TARGET, {
        cwd: workspace,
        model,
        name: agentId,
        minimal: true,
      });
      const session = {
        sessionId: encodeHiveSessionAddress({ target: LOCAL_WORKSPACE_TARGET, threadId: thread.threadId }),
        provider: "pi",
        sessionName: agentId,
        workspace,
        persistenceLevel: 2,
        runtimeManagedHistory: false,
      };
      sessions.set(agentId, thread.threadId);
      await runtime.registerAgent(roomId, { agentId, adapterId: adapter.adapterId, session });
    }

    const taskRecords = new Map();
    const taskWaiters = [];
    unsubscribeTasks = runtime.subscribe((event) => {
      if (event.type !== "task.updated") return;
      taskRecords.set(event.task.task.taskId, event.task);
      for (let index = taskWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = taskWaiters[index];
        if (waiter.matches(event.task)) {
          taskWaiters.splice(index, 1);
          waiter.resolve(event.task);
        }
      }
    });
    const awaitTaskRecord = (matches, timeoutMs, timeoutMessage) => {
      const existing = [...taskRecords.values()].find(matches);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = taskWaiters.findIndex((waiter) => waiter.resolve === finish);
          if (index >= 0) taskWaiters.splice(index, 1);
          reject(new Error(timeoutMessage));
        }, timeoutMs);
        const finish = (task) => { clearTimeout(timer); resolve(task); };
        taskWaiters.push({ matches, resolve: finish });
      });
    };
    const findTask = (matches) => awaitTaskRecord(matches, 180_000, "Timed out waiting for the Pi A2A task to be scheduled");
    const waitCompleted = async (taskId) => {
      const completed = await awaitTaskRecord((record) => record.task.taskId === taskId &&
        ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(record.state), 180_000,
      `Timed out waiting for Pi task ${taskId} to finish`);
      assert.equal(completed.state, "COMPLETED", completed.error?.message ?? `Pi task ${taskId} failed`);
      return completed;
    };

    await piTurns.sendPrompt(LOCAL_WORKSPACE_TARGET, sessions.get("pi-a2a-caller"), {
      text: "Use a2a_send exactly once to send asynchronous work to pi-a2a-worker. Ask it to reply with a2a_reply and return the exact result HIVE_PI_A2A_OK. Do not use any local tools and do not wait for the result.",
      cwd: workspace,
    });
    const request = await findTask((record) => record.task.sourceAgent === "pi-a2a-caller" &&
      record.task.targetAgent === "pi-a2a-worker" && record.task.metadata?.delivery === "a2a-async-request");
    const callback = await findTask((record) => record.task.sourceAgent === "pi-a2a-worker" &&
      record.task.targetAgent === "pi-a2a-caller" && record.task.metadata?.delivery === "a2a-result-callback" &&
      record.task.metadata?.callbackForTaskId === request.task.taskId);
    const completedRequest = await waitCompleted(request.task.taskId);
    const completedCallback = await waitCompleted(callback.task.taskId);
    assert.match(completedCallback.result?.message ?? "", /HIVE_PI_A2A_OK/);
    assert.equal(completedRequest.task.metadata?.delivery, "a2a-async-request");

    await piTurns.sendPrompt(LOCAL_WORKSPACE_TARGET, sessions.get("pi-a2b-caller"), {
      text: "Use a2b_send exactly once for pi-a2b-bonded. Ask that agent to return the exact text HIVE_PI_A2B_OK directly. Do not use local tools and do not wait.",
      cwd: workspace,
    });
    const bondedRequest = await findTask((record) => record.task.sourceAgent === "pi-a2b-caller" &&
      record.task.targetAgent === "pi-a2b-bonded" && record.task.metadata?.delivery === "a2b-bonded-request");
    const completedBonded = await waitCompleted(bondedRequest.task.taskId);
    assert.match(completedBonded.result?.message ?? "", /HIVE_PI_A2B_OK/);
    assert.equal(modelRequests.some((request) => request.toolName === "a2b_send" && request.targetAgent === "pi-a2b-bonded"), true);
    assert.equal(modelRequests.some((request) => request.toolName === "a2a_send" && request.targetAgent === "pi-a2a-worker" &&
      request.prompt.includes("Bonded A2B from pi-a2b-caller")), true,
    "the Pi A2B responder should exercise Hive's runtime branch guard");
    assert.equal([...taskRecords.values()].some((record) => record.task.sourceAgent === "pi-a2b-bonded" &&
      record.task.targetAgent === "pi-a2a-worker"), false, "a rejected branch must not create a subtask");
    assert.equal(providerEvents.some((event) => event.type === "toolStarted" && event.provider === "pi"), true,
      "the turn must execute through the Pi RPC tool loop");
    assert.equal(runtime.listAgents(roomId).every((agent) => agent.provider === "pi"), true,
      "the isolated runtime must contain only Pi agents");
  } finally {
    unsubscribeTasks?.();
    await server?.close().catch(() => undefined);
    await piContext?.closeAll().catch(() => undefined);
    await closeServer(modelServer);
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
