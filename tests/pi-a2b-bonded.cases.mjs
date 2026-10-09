import assert from "node:assert/strict";
import { test } from "node:test";
import { createPiFixture, readAcknowledgement, resultFor } from "./pi-a2a-test-support.mjs";

test("Pi A2B stays bonded, rejects a branch, and accepts its own callback", async () => {
  const branchAttempts = [];
  const callbacks = [];
  let piAgents;
  const fixture = await createPiFixture(async (_session, task) => {
    if (task.targetAgent === "bonded" && task.metadata?.delivery === "a2b-bonded-request") {
      const branch = await piAgents.bonded.call("a2a_send", {
        targetAgent: "other",
        message: "This branch must be rejected.",
      });
      branchAttempts.push(branch);
      const callback = await piAgents.bonded.call("a2a_reply", {
        message: "Bonded Pi result.",
        replyToTaskId: task.taskId,
      });
      callbacks.push(readAcknowledgement(callback));
      return resultFor(task, "Bonded Pi responder completed.");
    }
    return resultFor(task, "Pi A2B callback recipient completed.");
  });
  piAgents = fixture.piAgents;

  try {
    const listed = await piAgents.caller.call("a2a_list", {});
    const listedAgents = JSON.parse(listed.content[0].text);
    const runtimeAgents = fixture.runtime.listAgents("pi-test");
    const callerAgent = runtimeAgents.find((agent) => agent.agentId === "caller");
    const bondedAgent = runtimeAgents.find((agent) => agent.agentId === "bonded");
    assert.equal(listedAgents.some((agent) => agent.targetAgent === callerAgent.callerAgentId), false);
    assert.equal(listedAgents.some((agent) => agent.targetAgent === bondedAgent.callerAgentId), true);
    const listedBondedAgent = listedAgents.find((agent) => agent.targetAgent === bondedAgent.callerAgentId);
    assert.equal(typeof listedBondedAgent.sessionName, "string");
    assert.equal(listedBondedAgent.sessionName, "Pi user session bonded");
    assert.equal(listedBondedAgent.provider, "pi");
    assert.match(listedBondedAgent.targetAgent, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal("agentId" in listedBondedAgent, false);
    assert.equal("callerAgentId" in listedBondedAgent, false);

    const sent = await piAgents.caller.call("a2b_send", {
      targetAgent: "bonded",
      message: "Handle this Pi A2B request directly.",
    });
    const acknowledgement = readAcknowledgement(sent);
    assert.equal(acknowledgement.accepted, true);
    assert.equal(fixture.runtime.getTask(acknowledgement.taskId).task.metadata.delivery, "a2b-bonded-request");
    assert.equal((await fixture.runtime.waitForTask(acknowledgement.taskId, 2_000)).state, "COMPLETED");

    assert.equal(branchAttempts.length, 1);
    assert.equal(branchAttempts[0].isError, true);
    assert.match(branchAttempts[0].content[0].text, /bonded|delegate|branch/i);
    assert.equal(fixture.runtimeRequests.some(({ agentId, input }) => agentId === "other" && input.task.sourceAgent === "bonded"), false);
    assert.equal(callbacks.length, 1);
    assert.equal(fixture.runtime.getTask(callbacks[0].taskId).task.metadata.delivery, "a2a-result-callback");
    assert.equal(fixture.runtime.getTask(callbacks[0].taskId).task.targetAgent, "caller");
    assert.equal((await fixture.runtime.waitForTask(callbacks[0].taskId, 2_000)).state, "COMPLETED");
    assert.equal(fixture.runtimeEvents.some((event) =>
      event.type === "a2aCommunicationSummary" && event.provider === "pi" && event.threadId === "native:caller"), true);
  } finally {
    await fixture.close();
  }
});
