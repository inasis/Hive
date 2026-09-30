import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { A2ARuntimeAdminPort } from "../../application/ports/a2a-runtime.js";
import type { A2ATaskSubmission, AgentSelector } from "../../domain/a2a.js";

export type A2AHttpServerOptions = {
  host: string;
  port: number;
  bearerToken: string;
  tlsFiles?: { certificatePath: string; privateKeyPath: string };
  maxRequestBytes?: number;
  heartbeatIntervalMs?: number;
};

const A2A_MCP_TOOLS = [
  {
    name: "a2a_list_agents",
    description: "List other Hive agents with their sessionName, agentId, role, capabilities, state, provider, and workspace.",
    inputSchema: {
      type: "object",
      properties: {
        callerAgentId: { type: "string", minLength: 1, description: "Current Hive agent ID from the active A2A task prompt. Include it when Hive supplied one so the caller can be verified if native session metadata is unavailable." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "a2a_send",
    description: "Queue work for another Hive agent. Returns only an accepted taskId, not the result. When you need the answer, you must call a2a_wait_task with that ID until completed is true; do not treat acceptance as the task result. A2A results also appear as communication summaries in the caller session.",
    inputSchema: {
      type: "object",
      properties: {
        callerAgentId: { type: "string", minLength: 1, description: "Current Hive agent ID from the active A2A task prompt. Include it when Hive supplied one so the caller can be verified if native session metadata is unavailable." },
        targetAgent: { type: "string", minLength: 1, description: "Exact agentId from a2a_list_agents; prefer this for registered sessions." },
        targetSessionName: { type: "string", minLength: 1, maxLength: 120, description: "Provider session title; Hive creates a session with this name if no match exists." },
        selector: {
          type: "object",
          properties: {
            role: { type: "string" },
            capabilities: { type: "array", items: { type: "string" } },
            provider: { type: "string" },
            workspace: { type: "string" },
          },
          minProperties: 1,
          additionalProperties: false,
        },
        message: { type: "string", minLength: 1, description: "Work request or callback result." },
        timeoutMs: { type: "integer", minimum: 1, description: "Optional task timeout in milliseconds." },
        callbackForTaskId: { type: "string", minLength: 1, description: "Task ID of the request being answered; targetAgent must be its original caller." },
      },
      required: ["message"],
      anyOf: [{ required: ["targetAgent"] }, { required: ["targetSessionName"] }, { required: ["selector"] }],
      additionalProperties: false,
    },
  },
  {
    name: "a2a_wait_task",
    description: "Wait briefly for an accepted A2A task and return its actual result. Repeat with the same taskId while completed is false.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", minLength: 1, description: "Task ID returned by a2a_send." },
        waitMs: { type: "integer", minimum: 1, maximum: 30000, description: "How long to wait before returning the latest state; defaults to 20000." },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
];

/** Versioned HTTP/SSE transport for the provider-neutral A2A runtime. */
export class A2AHttpServer {
  private server: Server | undefined;
  private readonly eventStreams = new Set<ServerResponse>();

  constructor(
    private readonly runtime: A2ARuntimeAdminPort,
    private readonly options: A2AHttpServerOptions,
  ) {
    if (!options.host.trim()) throw new Error("A2A HTTP host must be non-empty");
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) throw new Error("A2A HTTP port is invalid");
    if (options.bearerToken.trim().length < 32) throw new Error("A2A HTTP bearer token must contain at least 32 characters");
    if (Boolean(options.tlsFiles?.certificatePath) !== Boolean(options.tlsFiles?.privateKeyPath)) {
      throw new Error("Configure both A2A TLS certificate and private key paths");
    }
    if (!options.tlsFiles && !isLoopbackHost(options.host)) {
      throw new Error("A2A HTTP requires TLS when binding to a non-loopback address");
    }
  }

  async listen(): Promise<void> {
    if (this.server) throw new Error("A2A HTTP server is already listening");
    const handler = (request: IncomingMessage, response: ServerResponse): void => {
      void this.handle(request, response);
    };
    const server = this.options.tlsFiles
      ? createHttpsServer({
          cert: await readFile(this.options.tlsFiles.certificatePath),
          key: await readFile(this.options.tlsFiles.privateKeyPath),
        }, handler)
      : createServer(handler);
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        this.server = undefined;
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.port, this.options.host);
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    for (const response of this.eventStreams) response.end();
    this.eventStreams.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (!this.isAuthorized(request)) {
      sendJson(response, 401, { error: { code: "UNAUTHORIZED", message: "A valid bearer token is required." } });
      return;
    }
    if (request.url === undefined) {
      sendJson(response, 400, { error: { code: "INVALID_REQUEST", message: "Request URL is missing." } });
      return;
    }

    let pathname: string;
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url, "http://localhost");
      pathname = requestUrl.pathname;
    } catch {
      sendJson(response, 400, { error: { code: "INVALID_REQUEST", message: "Request URL is invalid." } });
      return;
    }
    if (pathname === "/mcp") {
      try {
        await this.handleMcp(request, response, requestUrl);
      } catch (error) {
        if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
        else {
          const detail = readSafeError(error);
          sendJson(response, detail.status, { error: detail.body });
        }
      }
      return;
    }
    const segments = pathname.split("/").filter(Boolean).map(decodePathSegment);
    if (segments[0] !== "v1") {
      sendJson(response, 404, { error: { code: "NOT_FOUND", message: "A2A endpoint was not found." } });
      return;
    }

    try {
      await this.route(request, response, segments.slice(1));
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const detail = readSafeError(error);
      sendJson(response, detail.status, { error: detail.body });
    }
  }

  private async handleMcp(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "MCP requests must use POST." } });
      return;
    }
    const packet = await readJsonObject(request, this.options.maxRequestBytes ?? 1_048_576);
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
          instructions: "Use a2a_list_agents to find agents. A Hive A2A task prompt supplies your current agent ID; pass it as callerAgentId to a2a_list_agents and a2a_send so Hive can verify the active task. a2a_send returns acceptance only, not the answer. When you need the result, use a2a_wait_task until completed is true; never report the acceptance as the completed result.",
        };
      } else if (packet.method === "ping" || packet.method === "notifications/initialized") {
        result = {};
      } else if (packet.method === "tools/list") {
        result = { tools: A2A_MCP_TOOLS };
      } else if (packet.method === "tools/call") {
        result = await this.callMcpTool(packet.params, url, request);
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

  private async callMcpTool(
    paramsValue: unknown,
    url: URL,
    request: IncomingMessage,
  ): Promise<unknown> {
    const params = asRecord(paramsValue);
    const name = typeof params?.name === "string" ? params.name : "";
    const input = asRecord(params?.arguments) ?? {};
    const provider = headerString(request, "x-hive-provider") ?? url.searchParams.get("provider") ?? "";
    const target = headerString(request, "x-hive-target") ?? url.searchParams.get("target") ?? "";
    const nativeSessionId = readNativeSessionId(params ?? {});
    const callerAgentId = optionalToolString(input.callerAgentId, "callerAgentId");

    if (name === "a2a_wait_task") {
      const taskId = requiredToolString(input.taskId, "taskId");
      const waitMs = input.waitMs;
      if (waitMs !== undefined && (typeof waitMs !== "number" || !Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 30_000)) {
        throw new Error("waitMs must be an integer from 1 to 30000.");
      }
      const result = await this.runtime.waitForTask(taskId, typeof waitMs === "number" ? waitMs : undefined);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        ...(result.completed && result.state !== "COMPLETED" ? { isError: true } : {}),
      };
    }

    const nativeSessionSource = nativeSessionId
      ? await this.runtime.resolveNativeSessionAgent(provider, nativeSessionId)
      : undefined;
    let source = nativeSessionSource;
    if (callerAgentId) {
      if (!provider) throw new Error("provider metadata is required to verify callerAgentId.");
      const taskSource = await this.runtime.resolveActiveAgentForTask(provider, callerAgentId);
      if (!taskSource) throw new Error("callerAgentId does not identify exactly one active Hive A2A task.");
      if (source && source.agentId !== taskSource.agentId) throw new Error("callerAgentId does not match the resolved native session.");
      source = taskSource;
    } else if (!source && provider && target) {
      source = await this.runtime.resolveActiveAgentForTarget(provider, target);
    }
    if (!source) throw new Error("Hive could not identify the calling native session. Keep only one active session per provider target or reconnect the session.");

    if (name === "a2a_list_agents") {
      const room = this.runtime.listRooms().find((candidate) => candidate.agentIds.includes(source.agentId));
      if (room) await this.runtime.ensureSessionsDiscovered(room.roomId);
      const agents = this.runtime.listAgentsForAgent(source.agentId).filter((agent) => agent.agentId !== source.agentId);
      return { content: [{ type: "text", text: JSON.stringify(agents) }] };
    }
    if (name !== "a2a_send") throw new Error(`Unknown Hive A2A tool: ${name || "(missing name)"}`);
    const message = requiredToolString(input.message, "message");
    const targetAgent = optionalToolString(input.targetAgent, "targetAgent");
    const targetSessionName = optionalToolString(input.targetSessionName, "targetSessionName");
    const selector = parseToolSelector(input.selector);
    if (Boolean(targetAgent || targetSessionName) === Boolean(selector)) {
      throw new Error("Provide a targetSessionName/targetAgent or a selector.");
    }
    if (targetSessionName && targetSessionName.length > 120) throw new Error("targetSessionName must be 120 characters or fewer.");
    const timeoutMs = input.timeoutMs;
    if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
      throw new Error("timeoutMs must be a positive integer.");
    }
    const callbackForTaskId = optionalToolString(input.callbackForTaskId, "callbackForTaskId");
    const toolRequest = {
      ...(targetAgent ? { targetAgent } : {}),
      ...(targetSessionName ? { targetSessionName } : {}),
      ...(selector ? { selector } : {}),
      message,
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
      ...(callbackForTaskId ? { callbackForTaskId } : {}),
    };
    const result = nativeSessionSource && nativeSessionId
      ? await this.runtime.sendFromNativeSession(provider, nativeSessionId, toolRequest)
      : await this.runtime.sendFromAgent(source.agentId, toolRequest);
    return {
      content: [{ type: "text", text: JSON.stringify({ accepted: true, taskId: result.task.taskId, state: result.state }) }],
      ...(result.state === "FAILED" || result.state === "CANCELLED" || result.state === "TIMED_OUT" ? { isError: true } : {}),
    };
  }

  private async route(request: IncomingMessage, response: ServerResponse, path: string[]): Promise<void> {
    const method = request.method ?? "GET";
    if (method === "GET" && path.length === 1 && path[0] === "rooms") {
      sendJson(response, 200, { rooms: this.runtime.listRooms() });
      return;
    }
    if (method === "POST" && path.length === 1 && path[0] === "rooms") {
      const input = await readJsonObject(request, this.options.maxRequestBytes ?? 1_048_576);
      sendJson(response, 201, await this.runtime.createRoom(requiredString(input.roomId, "roomId"), requiredString(input.name, "name")));
      return;
    }
    if (method === "GET" && path.length === 1 && path[0] === "adapters") {
      sendJson(response, 200, { adapters: this.runtime.listAdapters() });
      return;
    }
    if (method === "GET" && path.length === 2 && path[0] === "tasks") {
      const task = this.runtime.getTask(path[1]!);
      if (!task) throw httpError(404, "NOT_FOUND", "Task was not found.");
      sendJson(response, 200, task);
      return;
    }
    if (method === "POST" && path.length === 3 && path[0] === "tasks" && path[2] === "cancel") {
      sendJson(response, 200, await this.runtime.cancelTask(path[1]!));
      return;
    }
    if (method === "POST" && path.length === 1 && path[0] === "tasks") {
      const input = await readJsonObject(request, this.options.maxRequestBytes ?? 1_048_576) as unknown as A2ATaskSubmission;
      sendJson(response, 202, await this.runtime.enqueueTask(input));
      return;
    }
    if (method === "GET" && path.length === 2 && path[0] === "task-graphs") {
      sendJson(response, 200, { tasks: this.runtime.getTaskGraph(path[1]!) });
      return;
    }
    if (method === "GET" && path.length === 3 && path[0] === "rooms" && path[2] === "agents") {
      sendJson(response, 200, { agents: this.runtime.listAgents(path[1]!) });
      return;
    }
    if (method === "POST" && path.length === 3 && path[0] === "rooms" && path[2] === "discover") {
      const input = await readJsonObject(request, this.options.maxRequestBytes ?? 1_048_576, true);
      const adapterId = input.adapterId === undefined ? undefined : requiredString(input.adapterId, "adapterId");
      sendJson(response, 200, await this.runtime.discoverSessions(path[1]!, adapterId));
      return;
    }
    if (method === "POST" && path.length === 3 && path[0] === "rooms" && path[2] === "refresh") {
      sendJson(response, 200, { agents: await this.runtime.refreshAvailability(path[1]!) });
      return;
    }
    if (method === "PATCH" && path.length === 2 && path[0] === "agents") {
      const input = await readJsonObject(request, this.options.maxRequestBytes ?? 1_048_576);
      const update: { role?: string | null; capabilities?: string[] } = {};
      if (input.role !== undefined) {
        if (input.role !== null && typeof input.role !== "string") throw httpError(400, "INVALID_REQUEST", "role must be a string or null.");
        update.role = input.role as string | null;
      }
      if (input.capabilities !== undefined) {
        if (!Array.isArray(input.capabilities) || input.capabilities.some((value) => typeof value !== "string")) {
          throw httpError(400, "INVALID_REQUEST", "capabilities must be an array of strings.");
        }
        update.capabilities = input.capabilities as string[];
      }
      if (Object.keys(update).length === 0) throw httpError(400, "INVALID_REQUEST", "Provide role or capabilities to update.");
      sendJson(response, 200, await this.runtime.updateAgentProfile(path[1]!, update));
      return;
    }
    if (method === "GET" && path.length === 1 && path[0] === "events") {
      this.streamEvents(request, response);
      return;
    }
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "A2A endpoint was not found." } });
  }

  private streamEvents(request: IncomingMessage, response: ServerResponse): void {
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    response.write(": connected\n\n");
    this.eventStreams.add(response);
    const unsubscribe = this.runtime.subscribe((event) => {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const interval = setInterval(() => response.write(": heartbeat\n\n"), this.options.heartbeatIntervalMs ?? 20_000);
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      unsubscribe();
      this.eventStreams.delete(response);
      if (!response.writableEnded) response.end();
    };
    request.once("aborted", close);
    response.once("close", close);
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
    const token = Buffer.from(authorization.slice(7), "utf8");
    const expected = Buffer.from(this.options.bearerToken, "utf8");
    return token.length === expected.length && timingSafeEqual(token, expected);
  }
}

async function readJsonObject(
  request: IncomingMessage,
  limit: number,
  allowEmpty = false,
): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw httpError(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw httpError(413, "INVALID_REQUEST", "Request body is too large.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > limit) throw httpError(413, "INVALID_REQUEST", "Request body is too large.");
    chunks.push(buffer);
  }
  if (!bytes && allowEmpty) return {};
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  }
  if (!isRecord(value)) throw httpError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  return value;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw httpError(400, "INVALID_REQUEST", `${name} must be a non-empty string.`);
  return value;
}

function requiredToolString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalToolString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredToolString(value, name);
}

function parseToolSelector(value: unknown): AgentSelector | undefined {
  if (value === undefined) return undefined;
  const selector = asRecord(value);
  if (!selector || Object.keys(selector).some((key) => !["role", "capabilities", "provider", "workspace"].includes(key))) {
    throw new Error("selector must contain only role, capabilities, provider, and workspace fields.");
  }
  const result: AgentSelector = {};
  for (const key of ["role", "provider", "workspace"] as const) {
    const candidate = selector[key];
    if (candidate !== undefined) result[key] = requiredToolString(candidate, `selector.${key}`);
  }
  if (selector.capabilities !== undefined) {
    if (!Array.isArray(selector.capabilities) || selector.capabilities.length === 0) throw new Error("selector.capabilities must be a non-empty string array.");
    result.capabilities = selector.capabilities.map((value) => requiredToolString(value, "selector.capabilities[]"));
  }
  if (!Object.keys(result).length) throw new Error("selector must include at least one constraint.");
  return result;
}

function readNativeSessionId(params: Record<string, unknown>): string | undefined {
  const metadata = asRecord(params._meta);
  // Codex supplies its calling thread in threadId; other MCP clients may use sessionID.
  const nativeSessionId = metadata?.threadId ?? metadata?.sessionID ?? metadata?.sessionId;
  return typeof nativeSessionId === "string" && nativeSessionId.trim() ? nativeSessionId.trim() : undefined;
}

function headerString(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function decodePathSegment(value: string): string {
  try { return decodeURIComponent(value); } catch { throw httpError(400, "INVALID_REQUEST", "Path contains invalid encoding."); }
}

function readSafeError(error: unknown): { status: number; body: { code: string; message: string; retryable?: boolean } } {
  if (isRecord(error) && isRecord(error.detail) && typeof error.detail.code === "string" && typeof error.detail.message === "string") {
    return {
      status: error.detail.code === "NO_AGENT_AVAILABLE" ? 503 : 400,
      body: {
        code: error.detail.code,
        message: error.detail.message,
        ...(typeof error.detail.retryable === "boolean" ? { retryable: error.detail.retryable } : {}),
      },
    };
  }
  if (isRecord(error) && typeof error.status === "number" && typeof error.code === "string" && typeof error.message === "string") {
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
  return { status: 500, body: { code: "INTERNAL_ERROR", message: "A2A request could not be completed." } };
}

function httpError(status: number, code: string, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}
