import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileSessionIdentityStore } from "../dist/infrastructure/persistence/session-identity-store.js";
import { InMemoryA2ARuntimeStateStore } from "../dist/infrastructure/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/infrastructure/workspace/a2a-locks.js";
import { SystemTimerAdapter } from "../dist/infrastructure/runtime/system-timers.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { InMemoryTaskRepository } from "../dist/infrastructure/persistence/in-memory-task-repository.js";
import { InMemoryAgentRepository } from "../dist/infrastructure/persistence/in-memory-agent-repository.js";
import { InMemoryRoomRepository } from "../dist/infrastructure/persistence/in-memory-room-repository.js";

test("the daemon persists a stable UUID and assigns a stable name when provider title is empty", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hive-session-identity-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "session-identities.json");
  const firstStore = new FileSessionIdentityStore(filePath);
  const first = await firstStore.getOrCreateIdentity("codex", "local", "native-thread");

  assert.match(first.hiveSessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(first.sessionName, /^Hive 세션 [0-9a-f]{8,32}$/i);
  assert.equal((await firstStore.getOrCreateIdentity("codex", "local", "native-thread")).sessionName, first.sessionName);

  const persisted = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(persisted.version, 2);
  assert.deepEqual(Object.values(persisted.identities)[0], first);

  const restarted = new FileSessionIdentityStore(filePath);
  const renamed = await restarted.getOrCreateIdentity("codex", "local", "native-thread", "Renamed session");
  assert.equal(renamed.hiveSessionId, first.hiveSessionId);
  assert.equal(renamed.sessionName, "Renamed session");
  assert.deepEqual(await new FileSessionIdentityStore(filePath).getOrCreateIdentity("codex", "local", "native-thread"), renamed);
});

test("UUID-only identity files migrate without changing IDs", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hive-session-identity-v1-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const provider = "codex";
  const target = "local";
  const nativeSessionId = "legacy-thread";
  const key = createHash("sha256").update(JSON.stringify([provider, target, nativeSessionId])).digest("hex");
  const hiveSessionId = "04f9c6bd-1c6e-4e68-905e-ae98b8934b0d";
  const filePath = join(directory, "session-identities.json");
  await writeFile(filePath, JSON.stringify({ version: 1, identities: { [key]: hiveSessionId } }));

  const identity = await new FileSessionIdentityStore(filePath).getOrCreateIdentity(provider, target, nativeSessionId);
  assert.equal(identity.hiveSessionId, hiveSessionId);
  assert.match(identity.sessionName, /^Hive 세션 /);
  const migrated = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.identities[key], identity);
});

test("A2A registration exposes the daemon-issued UUID and fallback session name", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hive-a2a-session-identity-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const identities = new FileSessionIdentityStore(join(directory, "session-identities.json"));
  let nextId = 0;
  const adapter = {
    adapterId: "test-adapter",
    provider: "custom",
    integrationStatus: "VERIFIED",
    capabilities: {
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
      delegation: false,
      concurrentTasks: false,
    },
    evidence: { source: "hive-provider-port", verifiedAt: "2026-10-02", confidence: "high", limitations: [] },
    async discoverSessions() { return []; },
    async isAvailable() { return true; },
    async execute() { throw new Error("not used"); },
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
    sessionIdentities: identities,
    createId: (kind) => `${kind}-${++nextId}`,
    now: () => 1,
  });
  await runtime.initialize();
  await runtime.createRoom("room", "Identity test");
  await runtime.registerAgent("room", {
    agentId: "worker",
    adapterId: adapter.adapterId,
    session: { sessionId: "native-thread", provider: "custom", persistenceLevel: 0, runtimeManagedHistory: false },
  });

  const [agent] = runtime.listAgents("room");
  assert.match(agent.callerAgentId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(agent.sessionName, /^Hive 세션 /);
  assert.deepEqual(await identities.getOrCreateIdentity("custom", adapter.adapterId, "native-thread"), {
    hiveSessionId: agent.callerAgentId,
    sessionName: agent.sessionName,
  });
});
