import assert from "node:assert/strict";
import { test } from "node:test";
import { createPiFixture, readAcknowledgement, resultFor } from "./pi-a2a-test-support.mjs";

test("Pi A2A tools deliver a response through Hive's authenticated MCP transport", async () => {
  const responses = [];
  let piAgents;
  const fixture = await createPiFixture(async (_session, task) => {
    if (task.targetAgent === "worker" && task.metadata?.delivery === "a2a-async-request") {
      const sent = await piAgents.worker.call("a2a_send", {
        targetAgent: "other",
        message: "Continue this Pi A2A result.",
        replyToTaskId: task.taskId,
      });
      const acknowledgement = readAcknowledgement(sent);
      responses.push({ task, acknowledgement });
      return resultFor(task, "Worker delivered the Pi A2A result.");
    }
    if (task.targetAgent === "other" && task.metadata?.delivery === "a2a-result-delivery") {
      const sent = await piAgents.other.call("a2a_send", {
        targetAgent: "caller",
        message: "Return the result to the caller.",
        replyToTaskId: task.taskId,
      });
      responses.push({ task, acknowledgement: readAcknowledgement(sent) });
    }
    return resultFor(task, "Pi A2A receiver completed.");
  });
  piAgents = fixture.piAgents;

  try {
    const sent = await piAgents.caller.call("a2a_send", {
      targetAgent: "worker",
      message: "Handle this Pi A2A request.",
    });
    const acknowledgement = readAcknowledgement(sent);
    assert.equal(acknowledgement.accepted, true);
    const request = fixture.runtimeRequests.find((entry) => entry.input.task.taskId === acknowledgement.taskId);
    assert.equal(request.provider, "pi");
    assert.equal(request.agentId, "worker");
    assert.equal(request.input.task.message, "Handle this Pi A2A request.");
    assert.equal((await fixture.runtime.waitForTask(acknowledgement.taskId, 2_000)).state, "COMPLETED");

    assert.equal(responses.length, 1);
    assert.equal(fixture.runtime.getTask(responses[0].acknowledgement.taskId).task.metadata.responseForTaskId, acknowledgement.taskId);
    assert.equal((await fixture.runtime.waitForTask(responses[0].acknowledgement.taskId, 2_000)).state, "COMPLETED");
    assert.equal(responses.length, 2);
    assert.equal(fixture.runtime.getTask(responses[1].acknowledgement.taskId).task.metadata.responseForTaskId, responses[0].acknowledgement.taskId);
    assert.equal((await fixture.runtime.waitForTask(responses[1].acknowledgement.taskId, 2_000)).state, "COMPLETED");
    assert.equal(fixture.runtimeEvents.some((event) =>
      event.type === "a2aCommunicationSummary" && event.provider === "pi" && event.threadId === "native:caller"), true);
  } finally {
    await fixture.close();
  }
});
