type JsonObject = Record<string, unknown>;

export type KiroSessionUpdate = { sessionId: string; update: JsonObject };
export type KiroServerRequest = { id: number | string; method: string; params: JsonObject };
export type KiroNotification = { method: string; params: JsonObject };

export type KiroAcpMessage =
  | { type: "invalid"; message: string }
  | { type: "request"; request: KiroServerRequest }
  | { type: "response"; id: number; result: unknown; error?: string }
  | { type: "notification"; notification: KiroNotification; sessionUpdate?: KiroSessionUpdate }
  | { type: "ignored" };

/** Decode one ACP JSON-RPC line into a provider-specific message. */
export function parseKiroAcpMessage(line: string): KiroAcpMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { type: "invalid", message: "Kiro ACP returned invalid JSON" };
  }
  const packet = asObject(parsed);
  if (!packet) return { type: "invalid", message: "Kiro ACP returned a non-object JSON message" };

  const id = typeof packet.id === "number" || typeof packet.id === "string" ? packet.id : undefined;
  if (id !== undefined && typeof packet.method === "string") {
    return { type: "request", request: { id, method: packet.method, params: asObject(packet.params) ?? {} } };
  }
  if (id !== undefined) {
    if (typeof id !== "number") return { type: "ignored" };
    const error = asObject(packet.error);
    return {
      type: "response",
      id,
      result: packet.result,
      ...(error ? { error: stringValue(error.message) ?? "Kiro ACP request failed" } : {}),
    };
  }
  if (typeof packet.method !== "string") return { type: "ignored" };

  const params = asObject(packet.params) ?? {};
  const notification: KiroNotification = { method: packet.method, params };
  if (packet.method === "session/update" || packet.method === "session/notification") {
    const sessionId = stringValue(params.sessionId);
    if (!sessionId) return { type: "ignored" };
    const update = asObject(params.update) ?? asObject(params.notification) ?? params;
    return { type: "notification", notification, sessionUpdate: { sessionId, update } };
  }
  return { type: "notification", notification };
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
