import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderSessionUseCases } from "../dist/application/use-cases/provider-sessions.js";

import { deferred, createHarness, resultFor, waitForSignal, waitForTerminal } from "./a2a-async-test-support.mjs";

test("A2A callback tasks remain visible when the original agent is offline", async () => {
  let callerAvailable = true;
  let callbackTaskId;
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "worker"],
    isAvailable: async (session) => session.sessionId !== "session:caller" || callerAvailable,
    execute: async (_session, task) => {
      if (task.targetAgent === "worker" && task.metadata?.delivery === "a2a-async-request") {
        callerAvailable = false;
        const callback = await runtime.sendFromAgent("worker", {
          targetAgent: "caller",
          callbackForTaskId: task.taskId,
          message: "Offline caller result.",
        });
        callbackTaskId = callback.task.taskId;
        return resultFor(task, `Callback accepted as ${callback.task.taskId}.`);
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  const request = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Run and callback." });
  const responder = await runtime.waitForTask(request.task.taskId, 1_000);
  const callback = await runtime.waitForTask(callbackTaskId, 1_000);
  assert.equal(responder.state, "COMPLETED", "accepted callback delivery is enough for the responder to finish");
  assert.equal(callback.state, "FAILED");
  assert.equal(callback.error.code, "SESSION_NOT_FOUND");
});

test("Hive-deleted native sessions are marked unavailable and rejected as A2A targets", async () => {
  let available = true;
  let adapterNotified = false;
  const { runtime, adapter } = await createHarness({
    agentIds: ["caller", "worker"],
    isAvailable: async () => available,
  });
  adapter.matchesNativeSessionOwner = (session, nativeSessionId) =>
    session.sessionId === "session:worker" && nativeSessionId === "worker";
  adapter.onNativeSessionDeleted = (session) => {
    assert.equal(session.sessionId, "session:worker");
    adapterNotified = true;
    available = false;
  };
  const providerSessions = new ProviderSessionUseCases({
    custom: {
      async deleteThread(target, threadId) {
        assert.equal(target, "local");
        assert.equal(threadId, "worker");
      },
    },
  }, (provider, target, threadId) => runtime.markNativeSessionUnavailable(provider, target, threadId));

  await providerSessions.deleteThread("custom", "local", "worker");

  const worker = runtime.listAgents("room").find((agent) => agent.agentId === "worker");
  assert.equal(adapterNotified, true);
  assert.equal(worker?.state, "OFFLINE");
  await assert.rejects(() => runtime.enqueueTask({ roomId: "room", targetAgent: "worker", message: "do not run" }),
    /not available for this task/);
  const refreshed = await runtime.refreshAvailability("room");
  assert.equal(refreshed.find((agent) => agent.agentId === "worker")?.state, "OFFLINE");
});

test("A2A child acquires the shared workspace after its sender finishes", async () => {
  const parentStarted = deferred();
  const childAccepted = deferred();
  const childStarted = deferred();
  const releaseParent = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "worker"],
    workspace: "/project",
    execute: async (_session, task) => {
      if (task.targetAgent === "caller" && task.message === "Hold shared workspace.") {
        parentStarted.resolve();
        const child = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Run after parent." });
        childAccepted.resolve(child);
        await releaseParent.promise;
        return resultFor(task, "Parent finished without waiting for child.");
      }
      if (task.targetAgent === "caller" && task.metadata?.delivery === "a2a-result-callback") {
        return resultFor(task, "Caller received child callback.");
      }
      assert.equal(task.targetAgent, "worker");
      await runtime.sendFromAgent("worker", {
        targetAgent: "caller",
        callbackForTaskId: task.taskId,
        message: "Child response.",
      });
      childStarted.resolve(task);
      return resultFor(task, "Child acquired the workspace.");
    },
  });
  runtime = harness.runtime;

  const parent = await runtime.enqueueTask({ roomId: "room", targetAgent: "caller", message: "Hold shared workspace." });
  try {
    await waitForSignal(parentStarted.promise, "parent execution", () => runtime.getTask(parent.task.taskId));
    const child = await waitForSignal(childAccepted.promise, "child acceptance", () => runtime.getTask(parent.task.taskId));
    assert.equal(runtime.getTask(child.task.taskId).state, "QUEUED");
    releaseParent.resolve();
    assert.equal((await runtime.waitForTask(parent.task.taskId, 1_000)).state, "COMPLETED");
    assert.equal((await childStarted.promise).targetAgent, "worker");
    assert.equal((await runtime.waitForTask(child.task.taskId, 1_000)).state, "COMPLETED");
  } finally {
    releaseParent.resolve();
  }
});

test("Workspace-queued A2A tasks can be cancelled or time out", async () => {
  const queued = deferred();
  const releaseParent = deferred();
  const childExecutions = [];
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "cancel-target", "timeout-target"],
    workspace: "/project",
    execute: async (_session, task) => {
      if (task.targetAgent === "caller" && task.message === "Hold shared workspace.") {
        const cancelled = await runtime.sendFromAgent("caller", {
          targetAgent: "cancel-target", message: "Cancel while queued.", timeoutMs: 5_000,
        });
        const timedOut = await runtime.sendFromAgent("caller", {
          targetAgent: "timeout-target", message: "Timeout while queued.", timeoutMs: 250,
        });
        queued.resolve({
          cancelled,
          timedOut,
          parentState: runtime.getTask(task.taskId).state,
          cancelledState: runtime.getTask(cancelled.task.taskId).state,
          timedOutState: runtime.getTask(timedOut.task.taskId).state,
        });
        await releaseParent.promise;
        return resultFor(task, "Parent released the workspace.");
      }
      childExecutions.push(task.targetAgent);
      return resultFor(task, "Unexpected child execution.");
    },
  });
  runtime = harness.runtime;

  const parent = await runtime.enqueueTask({ roomId: "room", targetAgent: "caller", message: "Hold shared workspace." });
  try {
    const children = await waitForSignal(queued.promise, "child queueing", () => runtime.getTask(parent.task.taskId));
    assert.equal(children.parentState, "RUNNING");
    assert.equal(children.cancelledState, "QUEUED");
    assert.equal(children.timedOutState, "QUEUED");
    const cancelled = await runtime.cancelTask(children.cancelled.task.taskId);
    const timedOut = await waitForTerminal(runtime, children.timedOut.task.taskId, 2_000);
    assert.equal(cancelled.state, "CANCELLED", JSON.stringify(cancelled));
    assert.equal(timedOut.state, "TIMED_OUT", JSON.stringify(timedOut));
    assert.deepEqual(childExecutions, []);
  } finally {
    releaseParent.resolve();
  }
  assert.equal((await runtime.waitForTask(parent.task.taskId, 1_000)).state, "COMPLETED");
});
