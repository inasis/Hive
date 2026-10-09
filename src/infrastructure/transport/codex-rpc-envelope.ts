type JsonObject = Record<string, unknown>;

/** Validated JSON-RPC message shape accepted from the Codex app-server stream. */
export type CodexRpcEnvelope = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

/** Parse and validate one decoded JSON value from a newline-delimited RPC frame. */
export function parseCodexRpcEnvelope(value: unknown): CodexRpcEnvelope | undefined {
  const message = asObject(value);
  if (!message) return undefined;
  if (message.id !== undefined && !((typeof message.id === "number" && Number.isFinite(message.id)) || typeof message.id === "string")) return undefined;
  if (message.method !== undefined && typeof message.method !== "string") return undefined;
  if (message.method !== undefined && ("result" in message || "error" in message)) return undefined;
  if (message.error !== undefined) {
    if (message.method !== undefined || message.id === undefined || "result" in message) return undefined;
    const error = asObject(message.error);
    if (!error) return undefined;
    if (error.code !== undefined && (typeof error.code !== "number" || !Number.isFinite(error.code))) return undefined;
    if (error.message !== undefined && typeof error.message !== "string") return undefined;
    return {
      ...(message.id !== undefined ? { id: message.id } : {}),
      ...(message.method !== undefined ? { method: message.method } : {}),
      ...(message.params !== undefined ? { params: message.params } : {}),
      ...(message.result !== undefined ? { result: message.result } : {}),
      error: {
        ...(error.code !== undefined ? { code: error.code } : {}),
        ...(error.message !== undefined ? { message: error.message } : {}),
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
    };
  }
  if (message.method === undefined && (message.id === undefined || !("result" in message))) return undefined;
  return {
    ...(message.id !== undefined ? { id: message.id } : {}),
    ...(message.method !== undefined ? { method: message.method } : {}),
    ...(message.params !== undefined ? { params: message.params } : {}),
    ...(message.result !== undefined ? { result: message.result } : {}),
  };
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
