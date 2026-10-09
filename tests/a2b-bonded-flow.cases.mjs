import assert from "node:assert/strict";
import { test } from "node:test";
import { A2AHttpServer } from "../dist/infrastructure/transport/a2a-http-server.js";
import { callMcpTool } from "./a2a-mcp-dispatch-test-support.mjs";

import { deferred, createHarness, resultFor, waitForSignal, faultCode } from "./a2a-async-test-support.mjs";

test("A2B binds one responder, blocks MCP and internal branches, and permits its own callback", async () => {
  const callbackReceived = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "bonded", "other"],
    execute: async (_session, task, context) => {
      if (task.targetAgent === "bonded" && task.metadata?.delivery === "a2b-bonded-request") {
        const branch = await Promise.allSettled([
          Promise.resolve().then(() => context.delegate({ targetAgent: "other", message: "internal branch" })),
          Promise.resolve().then(() => runtime.sendFromAgent("bonded", { targetAgent: "other", message: "runtime branch" })),
          Promise.resolve().then(() => runtime.sendFromAgent("bonded", { interaction: "A2B", targetAgent: "other", message: "bonded branch" })),
          callMcpTool(runtime, { name: "a2a_send", arguments: {
            callerAgentId: "bonded", targetAgent: "other", message: "MCP branch",
          } }, new URL("http://127.0.0.1/mcp?provider=custom")),
        ]);
        assert.equal(branch.every((attempt) => attempt.status === "rejected" && faultCode(attempt.reason) === "PERMISSION_DENIED"), true);

        await assert.rejects(() => runtime.sendFromAgent("other", {
          targetAgent: "caller",
          message: "Impersonated A2B callback.",
          callbackForTaskId: task.taskId,
        }), (error) => faultCode(error) === "INVALID_REQUEST");

        const callback = await callMcpTool(runtime, { name: "a2a_reply", arguments: {
          callerAgentId: "bonded",
          message: "Bonded result.",
          replyToTaskId: task.taskId,
        } }, new URL("http://127.0.0.1/mcp?provider=custom"));
        const ack = JSON.parse(callback.content[0].text);
        assert.equal(ack.accepted, true);
        return resultFor(task, "Bonded task result");
      }
      if (task.targetAgent === "caller" && task.metadata?.delivery === "a2a-result-callback") {
        callbackReceived.resolve(task);
        return resultFor(task, "caller received bonded result");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  await assert.rejects(() => runtime.sendFromAgent("caller", {
    interaction: "A2B", targetAgent: "missing", message: "not registered",
  }), (error) => faultCode(error) === "INVALID_REQUEST");
  await assert.rejects(() => runtime.sendFromAgent("caller", {
    interaction: "A2B", targetSessionName: "Bonded title", message: "title selection is forbidden",
  }), (error) => faultCode(error) === "INVALID_REQUEST");
  await assert.rejects(() => runtime.sendFromAgent("caller", {
    interaction: "A2B", selector: { role: "worker" }, message: "selector selection is forbidden",
  }), (error) => faultCode(error) === "INVALID_REQUEST");
  await assert.rejects(() => runtime.sendFromAgent("caller", {
    interaction: "A2B", targetAgent: "bonded", responseForTaskId: "task-1", message: "A2B cannot mark a delegated response",
  }), (error) => faultCode(error) === "INVALID_REQUEST");

  const request = await runtime.sendFromAgent("caller", {
    interaction: "A2B",
    targetAgent: "bonded",
    message: "Complete this task yourself.",
  });
  assert.equal(request.task.metadata.delivery, "a2b-bonded-request");
  const callbackTask = await callbackReceived.promise;
  assert.equal(callbackTask.sourceAgent, "bonded");
  assert.equal(callbackTask.targetAgent, "caller");
  assert.equal(callbackTask.metadata.callbackForTaskId, request.task.taskId);
  assert.equal(callbackTask.parentTaskId, undefined);
  assert.equal((await runtime.waitForTask(callbackTask.taskId, 1_000)).state, "COMPLETED");
  assert.equal((await runtime.waitForTask(request.task.taskId, 1_000)).result.message, "Bonded task result");
  assert.equal(runtime.getTaskGraph(request.task.taskId).length, 1);
});

test("Pi RPC session metadata identifies A2B callers and lets the bonded responder callback", async () => {
  const callbackReceived = deferred();
  let runtime;
  const mcpRuntime = {
    async resolveNativeSessionAgent(provider, nativeSessionId) {
      return provider === "pi" && ["session:caller", "session:bonded"].includes(nativeSessionId)
        ? { agentId: nativeSessionId === "session:caller" ? "caller" : "bonded" }
        : undefined;
    },
    async sendFromNativeSession(provider, nativeSessionId, input) {
      const sourceAgentId = nativeSessionId === "session:caller" ? "caller" : "bonded";
      return runtime.sendFromAgent(sourceAgentId, input);
    },
    async sendFromAgent(agentId, input) { return runtime.sendFromAgent(agentId, input); },
    listRooms() { return []; },
    async ensureSessionsDiscovered() {},
    listAgentsForAgent() { return []; },
  };
  const harness = await createHarness({
    provider: "pi",
    agentIds: ["caller", "bonded"],
    execute: async (_session, task) => {
      if (task.targetAgent === "bonded" && task.metadata?.delivery === "a2b-bonded-request") {
        const callback = await callMcpTool(mcpRuntime, {
          name: "a2a_reply",
          arguments: {
            message: "Bonded Pi result.",
            replyToTaskId: task.taskId,
          },
          _meta: { sessionID: "session:bonded" },
        }, new URL("http://localhost/mcp?provider=pi&target=hive-local%3A%2F%2F"));
        assert.equal(JSON.parse(callback.content[0].text).accepted, true);
        return resultFor(task, "Bonded Pi task result.");
      }
      if (task.targetAgent === "caller" && task.metadata?.delivery === "a2a-result-callback") {
        callbackReceived.resolve(task);
        return resultFor(task, "Pi caller received the bonded callback.");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  const accepted = await callMcpTool(mcpRuntime, {
    name: "a2b_send",
    arguments: { targetAgent: "bonded", message: "Review this task." },
    _meta: { sessionID: "session:caller" },
  }, new URL("http://localhost/mcp?provider=pi&target=hive-local%3A%2F%2F"));
  const acknowledgement = JSON.parse(accepted.content[0].text);
  assert.equal(acknowledgement.accepted, true);
  assert.equal(runtime.getTask(acknowledgement.taskId).task.metadata.delivery, "a2b-bonded-request");
  const callback = await waitForSignal(callbackReceived.promise, "Pi bonded callback", () => runtime.listTasks());
  assert.equal(callback.metadata.delivery, "a2a-result-callback");
  assert.equal(callback.targetAgent, "caller");
  assert.equal((await runtime.waitForTask(acknowledgement.taskId, 1_000)).state, "COMPLETED");
  assert.equal((await runtime.waitForTask(callback.taskId, 1_000)).state, "COMPLETED");
});
