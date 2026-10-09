import type { IncomingMessage, ServerResponse } from "node:http";
import type { A2ARuntimeAdminPort } from "../../application/ports/a2a-runtime.js";
import { httpError, readJsonObject, sendJson } from "./a2a-http-common.js";
import { parseA2AAgentProfileUpdate, parseA2ATaskSubmission } from "./a2a-v1-request-parser.js";

export type A2AV1HttpRuntimePort = Pick<
  A2ARuntimeAdminPort,
  | "listRooms"
  | "createRoom"
  | "listAdapters"
  | "getTask"
  | "cancelTask"
  | "enqueueTask"
  | "getTaskGraph"
  | "listAgents"
  | "discoverSessions"
  | "refreshAvailability"
  | "updateAgentProfile"
  | "subscribe"
>;

/** Handles the versioned A2A JSON and event-stream API under /v1. */
export class A2AV1HttpHandler {
  private readonly eventStreams = new Set<ServerResponse>();

  constructor(
    private readonly runtime: A2AV1HttpRuntimePort,
    private readonly maxRequestBytes: number,
    private readonly heartbeatIntervalMs: number,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, path: string[]): Promise<void> {
    const method = request.method ?? "GET";
    if (method === "GET" && path.length === 1 && path[0] === "rooms") {
      sendJson(response, 200, { rooms: this.runtime.listRooms() });
      return;
    }
    if (method === "POST" && path.length === 1 && path[0] === "rooms") {
      const input = await readJsonObject(request, this.maxRequestBytes);
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
      const input = parseA2ATaskSubmission(await readJsonObject(request, this.maxRequestBytes));
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
      const input = await readJsonObject(request, this.maxRequestBytes, true);
      const adapterId = input.adapterId === undefined ? undefined : requiredString(input.adapterId, "adapterId");
      sendJson(response, 200, await this.runtime.discoverSessions(path[1]!, adapterId));
      return;
    }
    if (method === "POST" && path.length === 3 && path[0] === "rooms" && path[2] === "refresh") {
      await readJsonObject(request, this.maxRequestBytes, true);
      sendJson(response, 200, { agents: await this.runtime.refreshAvailability(path[1]!) });
      return;
    }
    if (method === "PATCH" && path.length === 2 && path[0] === "agents") {
      const update = parseA2AAgentProfileUpdate(await readJsonObject(request, this.maxRequestBytes));
      sendJson(response, 200, await this.runtime.updateAgentProfile(path[1]!, update));
      return;
    }
    if (method === "GET" && path.length === 1 && path[0] === "events") {
      this.streamEvents(request, response);
      return;
    }
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "A2A endpoint was not found." } });
  }

  closeEventStreams(): void {
    for (const response of this.eventStreams) response.end();
    this.eventStreams.clear();
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
    const interval = setInterval(() => response.write(": heartbeat\n\n"), this.heartbeatIntervalMs);
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
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw httpError(400, "INVALID_REQUEST", `${name} must be a non-empty string.`);
  return value;
}
