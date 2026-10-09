import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonObject, sendJson } from "./a2a-http-common.js";
import { A2A_MCP_TOOLS } from "./a2a-mcp-tool-catalog.js";
import type { A2AMcpToolDispatcher } from "./a2a-mcp-tool-dispatcher.js";

/** Handles the MCP JSON-RPC protocol exposed at the authenticated /mcp endpoint. */
export class A2AMcpHttpHandler {
  constructor(
    private readonly toolDispatcher: A2AMcpToolDispatcher,
    private readonly maxRequestBytes: number,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "MCP requests must use POST." } });
      return;
    }
    const packet = await readJsonObject(request, this.maxRequestBytes);
    if (packet.jsonrpc !== "2.0" || typeof packet.method !== "string" ||
        (packet.id !== undefined && typeof packet.id !== "string" && typeof packet.id !== "number")) {
      sendJson(response, 400, { jsonrpc: "2.0", id: packet.id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
      return;
    }
    if (packet.id === undefined) {
      response.statusCode = 202;
      response.end();
      return;
    }
    const id = packet.id;
    try {
      let result: unknown;
      if (packet.method === "initialize") {
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "hive-a2a", version: "1.0.0" },
          instructions: "New work: call a2a_list with no arguments, then call a2a_send with targetAgent and message. Split large work into independent requests; set timeoutMs to 0 when duration is unknown. Reply to the current task sender: call a2a_reply with replyToTaskId and message; set timeoutMs to 0 if the reply work has unknown duration. Forward a result: call a2a_send with targetAgent, message, and replyToTaskId. Include callerAgentId from your task prompt in send and reply calls when supplied. accepted=true means queued; do not wait or poll. a2b_send must be answered directly.",
        };
      } else if (packet.method === "ping" || packet.method === "notifications/initialized") {
        result = {};
      } else if (packet.method === "tools/list") {
        result = { tools: A2A_MCP_TOOLS };
      } else if (packet.method === "tools/call") {
        result = await this.toolDispatcher.dispatch(packet.params, url, request);
      } else {
        sendJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
        return;
      }
      sendJson(response, 200, { jsonrpc: "2.0", id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "A2A tool request failed";
      if (packet.method === "tools/call") {
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: message }], isError: true },
        });
        return;
      }
      sendJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message } });
    }
  }
}
