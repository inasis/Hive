import assert from "node:assert/strict";
import { test } from "node:test";
import { isA2ARuntimeSnapshot } from "../dist/infrastructure/persistence/a2a-runtime-snapshot.js";
import { deferred, createHarness, resultFor } from "./a2a-async-test-support.mjs";

test("A2A flow can revisit agents and callback across independent roots", async () => {
  const toC = deferred();
  const callbackToB = deferred();
  const callbackToA = deferred();
  const reachedA = deferred();
  let runtime;
  let rootRequest;
  const harness = await createHarness({
    agentIds: ["A", "B", "C"],
    execute: async (_session, task) => {
      if (task.targetAgent === "B" && task.metadata?.delivery === "a2a-async-request") {
        const forwarded = await runtime.sendFromAgent("B", {
          targetAgent: "C",
          responseForTaskId: task.taskId,
          message: "B forwards the result to C.",
        });
        toC.resolve(forwarded);
        return resultFor(task, "B delivered the result to C.");
      }
      if (task.targetAgent === "C" && task.metadata?.delivery === "a2a-result-delivery") {
        const returned = await runtime.sendFromAgent("C", {
          targetAgent: "B",
          callbackForTaskId: task.taskId,
          message: "C returns the result to B.",
        });
        callbackToB.resolve(returned);
        return resultFor(task, "C returned the result to B.");
      }
      if (task.targetAgent === "B" && task.metadata?.delivery === "a2a-result-callback") {
        const returned = await runtime.sendFromAgent("B", {
          targetAgent: "A",
          callbackForTaskId: rootRequest.task.taskId,
          message: "B continues the same flow and returns the result to A.",
        });
        callbackToA.resolve(returned);
        return resultFor(task, "B sent the next callback.");
      }
      if (task.targetAgent === "A" && task.metadata?.delivery === "a2a-result-callback") {
        reachedA.resolve(task);
        return resultFor(task, "A received the result after B-C-B-A.");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  rootRequest = await runtime.sendFromAgent("A", { targetAgent: "B", message: "Start the A-B-C-B-A flow." });
  const forwarded = await toC.promise;
  const firstCallback = await callbackToB.promise;
  const secondCallback = await callbackToA.promise;
  const arrived = await reachedA.promise;
  assert.equal(rootRequest.task.metadata.delivery, "a2a-async-request");
  assert.equal(forwarded.task.metadata.delivery, "a2a-result-delivery");
  assert.equal(firstCallback.task.metadata.delivery, "a2a-result-callback");
  assert.equal(firstCallback.task.parentTaskId, undefined, "a callback remains an independent task root");
  assert.equal(secondCallback.task.metadata.delivery, "a2a-result-callback");
  assert.equal(secondCallback.task.metadata.callbackForTaskId, rootRequest.task.taskId);
  assert.equal(secondCallback.task.targetAgent, "A");
  assert.equal(arrived.metadata.callbackForTaskId, rootRequest.task.taskId);
  for (const task of [rootRequest.task, forwarded.task, firstCallback.task, secondCallback.task]) {
    assert.equal(task.metadata.a2aFlowId, rootRequest.task.metadata.a2aFlowId);
  }
  assert.deepEqual(
    [rootRequest.task, forwarded.task, firstCallback.task, secondCallback.task].map((task) => task.metadata.a2aFlowDepth),
    [0, 1, 2, 3],
  );
  for (const task of [rootRequest.task, forwarded.task, firstCallback.task, secondCallback.task]) {
    assert.equal((await runtime.waitForTask(task.taskId, 1_000)).state, "COMPLETED");
  }
  const snapshot = await harness.stateStore.load();
  assert.equal(isA2ARuntimeSnapshot(snapshot), true, "the flow remains a valid persisted task snapshot");
});

test("A2A result delivery can revisit an agent before returning to an earlier participant", async () => {
  const bToC = deferred();
  const cToD = deferred();
  const dToE = deferred();
  const eToC = deferred();
  const cToA = deferred();
  const reachedA = deferred();
  let runtime;
  let rootRequest;
  const harness = await createHarness({
    agentIds: ["A", "B", "C", "D", "E"],
    execute: async (_session, task) => {
      if (task.targetAgent === "B" && task.metadata?.delivery === "a2a-async-request") {
        const sent = await runtime.sendFromAgent("B", {
          targetAgent: "C", responseForTaskId: task.taskId, message: "B sends to C.",
        });
        bToC.resolve(sent);
        return resultFor(task, "B sent the result to C.");
      }
      if (task.targetAgent === "C" && task.metadata?.delivery === "a2a-result-delivery" && task.sourceAgent === "B") {
        const sent = await runtime.sendFromAgent("C", {
          targetAgent: "D", responseForTaskId: task.taskId, message: "C sends to D.",
        });
        cToD.resolve(sent);
        return resultFor(task, "C sent the result to D.");
      }
      if (task.targetAgent === "D" && task.metadata?.delivery === "a2a-result-delivery") {
        const sent = await runtime.sendFromAgent("D", {
          targetAgent: "E", responseForTaskId: task.taskId, message: "D sends to E.",
        });
        dToE.resolve(sent);
        return resultFor(task, "D sent the result to E.");
      }
      if (task.targetAgent === "E" && task.metadata?.delivery === "a2a-result-delivery") {
        const sent = await runtime.sendFromAgent("E", {
          targetAgent: "C", responseForTaskId: task.taskId, message: "E sends back to C.",
        });
        eToC.resolve(sent);
        return resultFor(task, "E sent the result back to C.");
      }
      if (task.targetAgent === "C" && task.metadata?.delivery === "a2a-result-delivery" && task.sourceAgent === "E") {
        const sent = await runtime.sendFromAgent("C", {
          targetAgent: "A", callbackForTaskId: rootRequest.task.taskId, message: "C returns the result to A.",
        });
        cToA.resolve(sent);
        return resultFor(task, "C returned the result to A.");
      }
      if (task.targetAgent === "A" && task.metadata?.delivery === "a2a-result-callback") {
        reachedA.resolve(task);
        return resultFor(task, "A received the result after A-B-C-D-E-C-A.");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  rootRequest = await runtime.sendFromAgent("A", { targetAgent: "B", message: "Start the multi-hop A2A flow." });
  const route = await Promise.all([bToC.promise, cToD.promise, dToE.promise, eToC.promise, cToA.promise]);
  const arrived = await reachedA.promise;
  assert.deepEqual(route.map(({ task }) => task.targetAgent), ["C", "D", "E", "C", "A"]);
  assert.equal(route[0].task.metadata.responseForTaskId, rootRequest.task.taskId);
  assert.equal(route[3].task.visitedAgents.filter((agentId) => agentId === "C").length, 2);
  assert.equal(route[4].task.metadata.delivery, "a2a-result-callback");
  assert.equal(route[4].task.metadata.callbackForTaskId, rootRequest.task.taskId);
  assert.equal(arrived.targetAgent, "A");
  assert.equal(arrived.metadata.callbackForTaskId, rootRequest.task.taskId);
  const flowTasks = [rootRequest.task, ...route.map(({ task }) => task)];
  assert.deepEqual(flowTasks.map((task) => task.metadata.a2aFlowDepth), [0, 1, 2, 3, 4, 5]);
  assert.equal(new Set(flowTasks.map((task) => task.metadata.a2aFlowId)).size, 1);
  for (const task of flowTasks) assert.equal((await runtime.waitForTask(task.taskId, 1_000)).state, "COMPLETED");
});
