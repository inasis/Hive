import assert from "node:assert/strict";
import { test } from "node:test";
import { A2AHttpServer } from "../dist/infrastructure/transport/a2a-http-server.js";
import { callMcpTool } from "./a2a-mcp-dispatch-test-support.mjs";

test("MCP a2a_wait_task returns the completed result without exposing the stored request", async () => {
  const runtime = {
    async waitForTask(taskId, waitMs) {
      assert.equal(taskId, "task-ready");
      assert.equal(waitMs, 1000);
      return { completed: true, taskId, state: "COMPLETED", result: { status: "COMPLETED", message: "자동차" } };
    },
  };
  const server = new A2AHttpServer(runtime, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "x".repeat(32),
  });
  const result = await callMcpTool(runtime,
    { name: "a2a_wait_task", arguments: { taskId: "task-ready", waitMs: 1000 } },
    new URL("http://localhost/mcp"),
    { headers: {} },
  );
  assert.deepEqual(JSON.parse(result.content[0].text), {
    completed: true,
    taskId: "task-ready",
    state: "COMPLETED",
    result: { status: "COMPLETED", message: "자동차" },
  });
});

test("MCP tools/list advertises asynchronous A2A and A2B tools without a wait tool", async () => {
  const server = new A2AHttpServer({}, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "x".repeat(32),
  });
  try {
    await server.listen();
    const address = server.server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"x".repeat(32)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(response.status, 200);
    const packet = await response.json();
    assert.deepEqual(packet.result.tools.map((tool) => tool.name), ["a2a_list", "a2a_send", "a2a_reply", "a2b_send"]);
    assert.equal(packet.result.tools.find((tool) => tool.name === "a2a_list").inputSchema.properties.callerAgentId.type, "string");
    assert.equal("required" in packet.result.tools.find((tool) => tool.name === "a2a_list").inputSchema, false);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_list").description, /with no arguments/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_list").description, /sessionName/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_list").description, /targetAgent/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_list").description, /provider/);
    assert.equal(packet.result.tools.find((tool) => tool.name === "a2a_send").inputSchema.properties.callerAgentId.type, "string");
    assert.equal(packet.result.tools.find((tool) => tool.name === "a2a_send").inputSchema.properties.replyToTaskId.type, "string");
    assert.deepEqual(packet.result.tools.find((tool) => tool.name === "a2a_send").inputSchema.required, ["targetAgent", "message"]);
    assert.deepEqual(packet.result.tools.find((tool) => tool.name === "a2a_reply").inputSchema.required, ["replyToTaskId", "message"]);
    assert.equal("anyOf" in packet.result.tools.find((tool) => tool.name === "a2a_send").inputSchema, false);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_send").description, /targetAgent and message/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_reply").description, /replyToTaskId and message/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_reply").description, /task's sender/);
    assert.match(packet.result.tools.find((tool) => tool.name === "a2a_send").description, /do not wait or poll/);
  } finally {
    await server.close();
  }
});
