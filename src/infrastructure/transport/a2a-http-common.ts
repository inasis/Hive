import type { IncomingMessage, ServerResponse } from "node:http";

export async function readJsonObject(
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

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function readSafeError(error: unknown): { status: number; body: { code: string; message: string; retryable?: boolean } } {
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

export function httpError(status: number, code: string, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodePathSegment(value: string): string {
  try { return decodeURIComponent(value); } catch { throw httpError(400, "INVALID_REQUEST", "Path contains invalid encoding."); }
}
