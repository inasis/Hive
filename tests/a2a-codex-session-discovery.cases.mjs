import assert from "node:assert/strict";
import { test } from "node:test";
import { HiveSessionAgentAdapter } from "../dist/infrastructure/providers/hive-session-agent.js";
import { encodeHiveSessionAddress } from "../dist/infrastructure/providers/hive-session-agent-address.js";
import { CodexSessionConversationAdapter } from "../dist/infrastructure/providers/codex/session-conversations.js";

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
  const adapter = new CodexSessionConversationAdapter({
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

test("deleting a Hive-created native session clears its temporary availability shortcut", async () => {
  const adapter = new HiveSessionAgentAdapter({
    adapterId: "hive-codex-session-test",
    provider: "codex",
    targets: ["local"],
    catalog: {
      async connect() {
        return { threads: [{ id: "caller-thread", title: "Caller", cwd: "/workspace", provider: "codex" }], models: [] };
      },
    },
    conversations: {
      async createThread() {
        return {
          threadId: "created-thread",
          thread: { id: "created-thread", title: "A2A target", cwd: "/workspace" },
          title: "A2A target",
        };
      },
    },
    sessions: {},
    sessionIdentities: {
      async reserve() { return "reserved-session-id"; },
      async bind(_provider, _target, _threadId, sessionId) { return sessionId; },
    },
    turns: {},
    subscribe() {},
    publishEvent() {},
    permissionHandling: "preserve-target",
  });
  const caller = {
    sessionId: encodeHiveSessionAddress({ target: "local", threadId: "caller-thread" }),
    provider: "codex",
    workspace: "/workspace",
    persistenceLevel: 2,
    runtimeManagedHistory: false,
  };
  const created = await adapter.createSession(caller, {});

  assert.equal(await adapter.isAvailable(created), true);
  assert.equal(adapter.matchesNativeSessionOwner(created, "created-thread"), true);
  adapter.onNativeSessionDeleted(created);
  assert.equal(await adapter.isAvailable(created), false);
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
  const adapter = new CodexSessionConversationAdapter({ async getOrConnect() { return session; } });

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
