import assert from "node:assert/strict";
import { test } from "node:test";

import { deferred, createHarness, resultFor, faultCode } from "./a2a-async-test-support.mjs";

test("A2A and A2B senders receive acceptance while provider work is still running", async () => {
  for (const interaction of ["A2A", "A2B"]) {
    const started = deferred();
    const blocked = deferred();
    const { runtime } = await createHarness({
      execute: async (_session, task) => {
        if (task.targetAgent === "worker") {
          started.resolve();
          return blocked.promise;
        }
        return resultFor(task, "unexpected caller task");
      },
    });

    const accepted = await runtime.sendFromAgent("caller", {
      interaction,
      targetAgent: "worker",
      message: `async ${interaction} request`,
    });
    await started.promise;
    assert.equal(accepted.task.targetAgent, "worker");
    assert.equal(accepted.task.metadata.delivery, interaction === "A2A" ? "a2a-async-request" : "a2b-bonded-request");
    assert.equal(runtime.getTask(accepted.task.taskId).state, "RUNNING");

    const cancelled = await runtime.cancelTask(accepted.task.taskId);
    assert.equal(cancelled.state, "CANCELLED");
    blocked.resolve(resultFor(accepted.task, "late provider result"));
  }
});

test("task adapters receive only the source and target from a large room", async () => {
  const seenAgents = [];
  const callbackAccepted = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "worker", ...Array.from({ length: 100 }, (_, index) => `room-agent-${index}`)],
    execute: async (_session, task, context) => {
      seenAgents.push(context.agents.map((agent) => agent.agentId).sort());
      if (task.metadata?.delivery === "a2a-async-request") {
        const callback = await runtime.sendFromAgent("worker", {
          targetAgent: "caller",
          callbackForTaskId: task.taskId,
          message: "Result delivered.",
        });
        callbackAccepted.resolve(callback.task.taskId);
      }
      return resultFor(task, "Task completed.");
    },
  });
  runtime = harness.runtime;

  const accepted = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Inspect one module." });
  assert.equal((await runtime.waitForTask(accepted.task.taskId, 1_000)).state, "COMPLETED");
  const callbackTaskId = await callbackAccepted.promise;
  assert.equal((await runtime.waitForTask(callbackTaskId, 1_000)).state, "COMPLETED");
  assert.deepEqual(seenAgents, [["caller", "worker"], ["caller", "worker"]]);
});

test("A2A does not spend a provider turn on targets that cannot deliver a response", async () => {
  let executed = false;
  const { runtime } = await createHarness({
    canDelegateForSession: (session) => session.sessionId !== "session:worker",
    execute: async (_session, task) => {
      executed = true;
      return resultFor(task, "This target cannot send an A2A response.");
    },
  });

  await assert.rejects(
    () => runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Inspect one module." }),
    (error) => faultCode(error) === "NO_AGENT_AVAILABLE",
  );
  assert.equal(executed, false);
});

test("Nested A2A permission inheritance uses the active caller task", async () => {
  const childAccepted = deferred();
  const releaseParent = deferred();
  const permissionRead = deferred();
  let runtime;
  let permissionTaskId;
  const harness = await createHarness({
    agentIds: ["caller", "worker"],
    permissionHandling: "inherit-caller",
    getPermissionProfile: async (_session, activeTask) => {
      permissionTaskId = activeTask?.taskId;
      permissionRead.resolve(activeTask);
      return { provider: "custom", profile: "caller-scope" };
    },
    execute: async (_session, task) => {
      if (task.metadata?.delivery === "a2a-result-callback") return resultFor(task, "Caller received the callback.");
      if (task.targetAgent === "caller") {
        const child = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Run independently." });
        childAccepted.resolve(child);
        await releaseParent.promise;
        return resultFor(task, "Caller completed without waiting for its child.");
      }
      await runtime.sendFromAgent("worker", {
        targetAgent: "caller",
        callbackForTaskId: task.taskId,
        message: "Child result delivered to caller.",
      });
      return resultFor(task, "Child completed.");
    },
  });
  runtime = harness.runtime;

  const parent = await runtime.enqueueTask({ roomId: "room", targetAgent: "caller", message: "Start an A2A task." });
  const child = await childAccepted.promise;
  const permissionSourceTask = await permissionRead.promise;
  assert.equal(permissionTaskId, parent.task.taskId);
  assert.equal(permissionSourceTask.targetAgent, "caller");
  releaseParent.resolve();
  assert.equal((await runtime.waitForTask(parent.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal((await runtime.waitForTask(child.task.taskId, 1_000)).state, "COMPLETED");
});

test("An A2A responder cannot succeed by only finishing with a task result", async () => {
  const executedAgents = [];
  const { runtime, summaries } = await createHarness({
    provider: "codex",
    promptAddress: true,
    execute: async (_session, task) => {
      executedAgents.push(task.targetAgent);
      return resultFor(task, "worker result");
    },
  });

  const request = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "inspect the parser" });
  const completed = await runtime.waitForTask(request.task.taskId, 1_000);
  assert.equal(completed.state, "FAILED");
  assert.equal(completed.error.code, "INVALID_REQUEST");
  assert.match(completed.error.message, /without delivering its response/);
  assert.deepEqual(executedAgents, ["worker"]);
  assert.equal(runtime.getTaskGraph(request.task.taskId).length, 1);
  const delivered = summaries.find((event) => event.type === "a2aCommunicationSummary" && event.threadId === "session:caller");
  assert.ok(delivered, "the direct caller's registered session receives the result summary");
  assert.equal(delivered.communications.some((item) => item.kind === "result" && /without delivering its response/.test(item.message)), true);
});

test("the internal adapter delegation port can mark an A2A response delivery", async () => {
  let deliveredTask;
  const { runtime } = await createHarness({
    execute: async (_session, task, context) => {
      if (task.metadata?.delivery === "a2a-async-request") {
        deliveredTask = await context.delegate({
          targetAgent: "other",
          responseForTaskId: task.taskId,
          message: "The parser rejects malformed input.",
        });
      }
      return resultFor(task, "Task completed.");
    },
  });

  const accepted = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Inspect the parser." });
  assert.equal((await runtime.waitForTask(accepted.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal(deliveredTask.task.metadata.delivery, "a2a-result-delivery");
  assert.equal(deliveredTask.task.metadata.responseForTaskId, accepted.task.taskId);
  assert.equal((await runtime.waitForTask(deliveredTask.task.taskId, 1_000)).state, "COMPLETED");
});

test("A2A can create a named target agent and deliver the task to it", async () => {
  const executions = [];
  let createdName;
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller"],
    createSession: async (source, input) => {
      createdName = input.sessionName;
      return {
        sessionId: "session:created-worker",
        provider: source.provider,
        workspace: source.workspace,
        sessionName: input.sessionName,
        persistenceLevel: 0,
        runtimeManagedHistory: false,
      };
    },
    execute: async (_session, task) => {
      executions.push(task.targetAgent);
      const callback = await runtime.sendFromAgent(task.targetAgent, {
        targetAgent: "caller",
        callbackForTaskId: task.taskId,
        message: "Created agent result.",
      });
      assert.equal(callback.task.metadata.delivery, "a2a-result-callback");
      return resultFor(task, "Response delivered to the caller.");
    },
  });
  runtime = harness.runtime;

  const accepted = await runtime.sendFromAgent("caller", { targetSessionName: "Fresh worker", message: "review this file" });
  const completed = await runtime.waitForTask(accepted.task.taskId, 1_000);
  assert.equal(createdName, "Fresh worker");
  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.result.message, "Response delivered to the caller.");
  assert.equal(runtime.listAgents("room").find((agent) => agent.agentId === accepted.task.targetAgent)?.sessionName, "Fresh worker");
  assert.deepEqual(executions, [accepted.task.targetAgent]);
});
