import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";

export const PI_A2A_EXTENSION_SOURCE = String.raw`
import { randomUUID } from "node:crypto";
import { Type } from "typebox";

const PROVIDER = "pi";
const TARGET = "${LOCAL_WORKSPACE_TARGET}";
const DESCRIPTION = "Hive A2A and A2B tools. Sends are asynchronous; continue without waiting or polling. Split large work into independent requests and return results with replyToTaskId. Set timeoutMs to 0 when a task's duration is unknown.";

function getEndpoint() {
  if (process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() === "false") return undefined;
  const token = process.env.HIVE_A2A_HTTP_TOKEN?.trim();
  const raw = process.env.HIVE_A2A_MCP_URL?.trim();
  if (!token || token.length < 32 || !raw) return undefined;
  try {
    const endpoint = new URL(raw);
    const host = endpoint.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const loopback = host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
    if ((endpoint.protocol !== "http:" && endpoint.protocol !== "https:") || endpoint.username || endpoint.password) return undefined;
    if (endpoint.protocol === "http:" && !loopback) return undefined;
    endpoint.searchParams.set("provider", PROVIDER);
    endpoint.searchParams.set("target", TARGET);
    return { endpoint, token };
  } catch {
    return undefined;
  }
}

async function callHiveTool(endpoint, token, toolName, args, signal, ctx) {
  const callerAgentId = process.env.HIVE_PI_CALLER_AGENT_ID?.trim() || args.callerAgentId;
  const callArguments = callerAgentId ? { ...args, callerAgentId } : args;
  const params = {
    name: toolName,
    arguments: callArguments,
    _meta: { sessionID: ctx.sessionManager.getSessionId() },
  };
  if (callerAgentId) params._meta.callerAgentId = callerAgentId;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("Hive A2A tool request timed out")), 30_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/call",
        params,
      }),
    });
    let packet;
    try { packet = await response.json(); }
    catch { throw new Error("Hive A2A endpoint returned an invalid response"); }
    if (!response.ok) throw new Error(packet?.error?.message || "Hive A2A endpoint returned HTTP " + response.status);
    if (packet?.error) throw new Error(packet.error.message || "Hive A2A tool call failed");
    const result = packet?.result;
    if (!result || !Array.isArray(result.content)) throw new Error("Hive A2A endpoint returned an invalid tool result");
    return {
      content: result.content,
      details: { server: "hive-a2a", tool: toolName },
      ...(result.isError === true ? { isError: true } : {}),
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export default function (pi) {
  const connection = getEndpoint();
  if (!connection) return;
  const register = (name, label, description, parameters) => pi.registerTool({
    name,
    label,
    description,
    promptSnippet: "Use " + name + " for Hive agent communication.",
    parameters,
    async execute(_toolCallId, args, signal, _onUpdate, ctx) {
      return callHiveTool(connection.endpoint, connection.token, name, args ?? {}, signal, ctx);
    },
  });

  register("a2a_list", "Hive agents", "Call with no arguments. Each entry shows targetAgent (Hive session UUID), sessionName, and provider. Copy targetAgent into a2a_send.targetAgent or a2b_send.targetAgent.", Type.Object({
    callerAgentId: Type.Optional(Type.String({ minLength: 1, description: "Optional caller identity if Hive session metadata cannot identify this caller." })),
  }, { additionalProperties: false }));

  const a2aParameters = Type.Object({
    callerAgentId: Type.Optional(Type.String({ minLength: 1, description: "Current Hive callerAgentId from the task prompt." })),
    targetAgent: Type.String({ minLength: 1, description: "Required. Copy the exact value from a2a_list." }),
    message: Type.String({ minLength: 1 }),
    replyToTaskId: Type.Optional(Type.String({ minLength: 1, description: "Current task ID when forwarding its result." })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0, description: "Task execution deadline in milliseconds; 0 disables automatic timeout." })),
  }, { additionalProperties: false });
  register("a2a_send", "Hive A2A send", DESCRIPTION + " Send new work or forward a result. Required: targetAgent and message. Copy targetAgent from a2a_list. To forward a result, also include replyToTaskId.", a2aParameters);

  register("a2a_reply", "Hive A2A reply", DESCRIPTION + " Reply to the current task's sender. Required: replyToTaskId and message. Copy the current task ID from the task prompt. Set timeoutMs to 0 when the reply work has unknown duration.", Type.Object({
    callerAgentId: Type.Optional(Type.String({ minLength: 1, description: "Current Hive callerAgentId from the task prompt." })),
    replyToTaskId: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0, description: "Task execution deadline in milliseconds; 0 disables automatic timeout." })),
  }, { additionalProperties: false }));

  register("a2b_send", "Hive bonded send", DESCRIPTION + " Send one bonded task to an exact targetAgent from a2a_list; that agent answers directly and cannot delegate.", Type.Object({
    callerAgentId: Type.Optional(Type.String({ minLength: 1 })),
    targetAgent: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0, description: "Task execution deadline in milliseconds; 0 disables automatic timeout." })),
  }, { additionalProperties: false }));
}
`;
