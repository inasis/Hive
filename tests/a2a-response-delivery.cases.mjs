import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, createHarness, resultFor, faultCode } from "./a2a-async-test-support.mjs";

test("A2A response delivery to an existing or new agent succeeds without waiting for the recipient", async () => {
  for (const recipient of [
    { kind: "existing", agentIds: ["origin", "responder", "recipient"], target: { targetAgent: "recipient" } },
    { kind: "new", agentIds: ["origin", "responder"], target: { targetSessionName: "Result recipient" } },
  ]) {
    const delivered = deferred();
    const recipientBlocked = deferred();
    const responseAcceptance = deferred();
    let createdSessionName;
    let runtime;
    const harness = await createHarness({
      agentIds: recipient.agentIds,
      ...(recipient.kind === "new" ? {
        createSession: async (source, input) => {
          createdSessionName = input.sessionName;
          return {
            sessionId: "session:result-recipient",
            provider: source.provider,
            workspace: source.workspace,
            sessionName: input.sessionName,
            persistenceLevel: 0,
            runtimeManagedHistory: false,
          };
        },
      } : {}),
      execute: async (_session, task) => {
        if (task.targetAgent === "responder" && task.metadata?.delivery === "a2a-async-request") {
          await assert.rejects(() => runtime.sendFromAgent("responder", {
            ...recipient.target,
            message: "Malformed result delivery.",
            responseForTaskId: "another-task",
          }), (error) => faultCode(error) === "INVALID_REQUEST");
          const accepted = await runtime.sendFromAgent("responder", {
            ...recipient.target,
            message: "Response: the parser accepts malformed input.",
            responseForTaskId: task.taskId,
          });
          responseAcceptance.resolve(accepted);
          return resultFor(task, "Response delivery accepted.");
        }
        if (task.message === "Response: the parser accepts malformed input.") {
          delivered.resolve(task);
          return recipientBlocked.promise.then(() => resultFor(task, "Recipient chose to finish."));
        }
        return resultFor(task, "unexpected task");
      },
    });
    runtime = harness.runtime;

    const request = await runtime.sendFromAgent("origin", { targetAgent: "responder", message: "Inspect the parser." });
    const [responseTask, recipientTask] = await Promise.all([responseAcceptance.promise, delivered.promise]);
    const responderResult = await runtime.waitForTask(request.task.taskId, 1_000);
    assert.equal(responderResult.state, "COMPLETED", `the responder ends after ${recipient.kind}-agent delivery is accepted`);
    assert.equal(responderResult.result.message, "Response delivery accepted.");
    assert.equal(responseTask.task.targetAgent, recipientTask.targetAgent);
    assert.equal(recipientTask.sourceAgent, "responder");
    assert.equal(recipientTask.metadata.delivery, "a2a-result-delivery");
    assert.equal(recipientTask.metadata.responseForTaskId, request.task.taskId);
    if (recipient.kind === "new") assert.equal(createdSessionName, "Result recipient");
    assert.equal(runtime.getTask(responseTask.task.taskId).state, "RUNNING", `the ${recipient.kind} recipient runs independently`);

    recipientBlocked.resolve();
    const recipientResult = await runtime.waitForTask(responseTask.task.taskId, 1_000);
    assert.equal(recipientResult.result.message, "Recipient chose to finish.");
  }
});

test("An A2A response recipient can forward the result again and then finish", async () => {
  const forwarded = deferred();
  const finalRecipient = deferred();
  let intermediateTaskId;
  let runtime;
  const { runtime: createdRuntime } = await createHarness({
    agentIds: ["origin", "responder", "recipient", "final-recipient"],
    execute: async (_session, task) => {
      if (task.targetAgent === "responder" && task.metadata?.delivery === "a2a-async-request") {
        await runtime.sendFromAgent("responder", {
          targetAgent: "recipient",
          responseForTaskId: task.taskId,
          message: "The parser accepts malformed input.",
        });
        return resultFor(task, "Response delivery accepted.");
      }
      if (task.targetAgent === "recipient" && task.metadata?.delivery === "a2a-result-delivery") {
        intermediateTaskId = task.taskId;
        const next = await runtime.sendFromAgent("recipient", {
          targetAgent: "final-recipient",
          responseForTaskId: task.taskId,
          message: `Forwarded result: ${task.message}`,
        });
        forwarded.resolve(next);
        return resultFor(task, "Recipient chose to forward and finish.");
      }
      if (task.targetAgent === "final-recipient") {
        finalRecipient.resolve(task);
        return resultFor(task, "Final recipient chose to finish.");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = createdRuntime;

  const request = await runtime.sendFromAgent("origin", { targetAgent: "responder", message: "Inspect the parser." });
  const next = await forwarded.promise;
  const finalTask = await finalRecipient.promise;
  assert.equal((await runtime.waitForTask(request.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal((await runtime.waitForTask(next.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal(finalTask.metadata.delivery, "a2a-result-delivery");
  assert.equal(finalTask.metadata.responseForTaskId, intermediateTaskId);
  assert.equal(finalTask.message, "Forwarded result: The parser accepts malformed input.");
  assert.equal((await runtime.waitForTask(finalTask.taskId, 1_000)).result.message, "Final recipient chose to finish.");
});

test("An A2A response recipient can return its result to the sender by callback", async () => {
  const callbackAccepted = deferred();
  const callbackStarted = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["origin", "responder", "recipient"],
    execute: async (_session, task) => {
      if (task.targetAgent === "responder" && task.metadata?.delivery === "a2a-async-request") {
        await runtime.sendFromAgent("responder", {
          targetAgent: "recipient",
          responseForTaskId: task.taskId,
          message: "The parser rejects malformed input.",
        });
        return resultFor(task, "Response delivery accepted.");
      }
      if (task.targetAgent === "recipient" && task.metadata?.delivery === "a2a-result-delivery") {
        const returned = await runtime.sendFromAgent("recipient", {
          targetAgent: "responder",
          callbackForTaskId: task.taskId,
          message: "Returning the response to its sender.",
        });
        callbackAccepted.resolve(returned);
        return resultFor(task, "Recipient chose to return the result.");
      }
      if (task.targetAgent === "responder" && task.metadata?.delivery === "a2a-result-callback") {
        callbackStarted.resolve(task);
        return resultFor(task, "Sender received the returned result.");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  const request = await runtime.sendFromAgent("origin", { targetAgent: "responder", message: "Inspect the parser." });
  const callback = await callbackAccepted.promise;
  const callbackTask = await callbackStarted.promise;
  assert.equal((await runtime.waitForTask(request.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal(callback.task.metadata.delivery, "a2a-result-callback");
  assert.equal(callback.task.metadata.callbackForTaskId, runtime.getTaskGraph(request.task.taskId)
    .find((record) => record.task.metadata?.delivery === "a2a-result-delivery").task.taskId);
  assert.equal(callbackTask.targetAgent, "responder");
  assert.equal((await runtime.waitForTask(callback.task.taskId, 1_000)).result.message, "Sender received the returned result.");
});

