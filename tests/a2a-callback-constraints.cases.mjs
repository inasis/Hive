import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, createHarness, resultFor, faultCode } from "./a2a-async-test-support.mjs";

test("A2A maxDepth applies across callback roots", async () => {
  const firstCallback = deferred();
  const callbackDepthRejected = deferred();
  let runtime;
  let rootRequest;
  const harness = await createHarness({
    agentIds: ["A", "B"],
    policy: { maxDepth: 1 },
    execute: async (_session, task) => {
      if (task.targetAgent === "B" && task.metadata?.delivery === "a2a-async-request") {
        const callback = await runtime.sendFromAgent("B", {
          targetAgent: "A", callbackForTaskId: task.taskId, message: "Return to A once.",
        });
        firstCallback.resolve(callback);
        return resultFor(task, "B sent one callback.");
      }
      if (task.targetAgent === "A" && task.metadata?.delivery === "a2a-result-callback") {
        await assert.rejects(() => runtime.sendFromAgent("A", {
          targetAgent: "B", callbackForTaskId: task.taskId, message: "Continue beyond the flow depth limit.",
        }), (error) => faultCode(error) === "MAX_DEPTH_EXCEEDED");
        callbackDepthRejected.resolve(task);
        return resultFor(task, "A stopped at the flow depth limit.");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  rootRequest = await runtime.sendFromAgent("A", { targetAgent: "B", message: "Start a bounded flow." });
  const callback = await firstCallback.promise;
  const callbackTask = await callbackDepthRejected.promise;
  assert.equal(rootRequest.task.metadata.a2aFlowDepth, 0);
  assert.equal(callback.task.metadata.a2aFlowDepth, 1);
  assert.equal(callbackTask.metadata.a2aFlowId, rootRequest.task.metadata.a2aFlowId);
  assert.equal((await runtime.waitForTask(rootRequest.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal((await runtime.waitForTask(callback.task.taskId, 1_000)).state, "COMPLETED");
});

test("A2A rejects callback IDs from another room or an earlier task", async () => {
  let runtime;
  let foreignTaskId;
  let staleTaskId;
  const harness = await createHarness({
    agentIds: ["origin", "responder", "new-source"],
    execute: async (_session, task) => {
      if (task.targetAgent === "foreign-responder" && task.metadata?.delivery === "a2a-async-request") {
        await runtime.sendFromAgent("foreign-responder", {
          targetAgent: "foreign-source",
          callbackForTaskId: task.taskId,
          message: "Foreign room response.",
        });
        return resultFor(task, "Foreign response accepted.");
      }
      if (task.targetAgent === "responder" && task.message === "Seed an old task.") {
        staleTaskId = task.taskId;
        await runtime.sendFromAgent("responder", {
          targetAgent: "origin",
          callbackForTaskId: task.taskId,
          message: "The old response.",
        });
        return resultFor(task, "Old response accepted.");
      }
      if (task.targetAgent === "responder" && task.message === "Probe invalid task IDs.") {
        const attempts = await Promise.allSettled([
          runtime.sendFromAgent("responder", {
            targetAgent: "foreign-source",
            callbackForTaskId: foreignTaskId,
            message: "Cross-room callback.",
          }),
          runtime.sendFromAgent("responder", {
            targetAgent: "origin",
            callbackForTaskId: staleTaskId,
            message: "Stale callback.",
          }),
        ]);
        assert.equal(attempts.every((attempt) => attempt.status === "rejected" && faultCode(attempt.reason) === "INVALID_REQUEST"), true);
        await runtime.sendFromAgent("responder", {
          targetAgent: "new-source",
          callbackForTaskId: task.taskId,
          message: "The current response.",
        });
        return resultFor(task, "Current response accepted.");
      }
      return resultFor(task, "Recipient finished.");
    },
  });
  runtime = harness.runtime;
  await runtime.createRoom("other-room", "Other room");
  for (const agentId of ["foreign-source", "foreign-responder"]) {
    await runtime.registerAgent("other-room", {
      agentId,
      adapterId: harness.adapter.adapterId,
      session: {
        sessionId: `session:${agentId}`,
        provider: "custom",
        persistenceLevel: 0,
        runtimeManagedHistory: false,
      },
    });
  }

  const oldRequest = await runtime.sendFromAgent("origin", { targetAgent: "responder", message: "Seed an old task." });
  assert.equal((await runtime.waitForTask(oldRequest.task.taskId, 1_000)).state, "COMPLETED");
  const foreignRequest = await runtime.sendFromAgent("foreign-source", { targetAgent: "foreign-responder", message: "Other room request." });
  foreignTaskId = foreignRequest.task.taskId;
  assert.equal((await runtime.waitForTask(foreignTaskId, 1_000)).state, "COMPLETED");
  const currentRequest = await runtime.sendFromAgent("new-source", { targetAgent: "responder", message: "Probe invalid task IDs." });
  assert.equal((await runtime.waitForTask(currentRequest.task.taskId, 1_000)).state, "COMPLETED");
});
