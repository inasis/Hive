import type { OpenCodeApiVersion } from "./api.js";
import {
  normalizeV2Message,
  parseOpenCodeMessage,
  type OpenCodeMessage,
} from "./conversation-protocol.js";
import type { OpenCodeHttpClient } from "./http-client.js";

type JsonObject = Record<string, unknown>;
const OPENCODE_MESSAGE_LIMIT = 200;

/** Reads and normalizes paged session messages from OpenCode v1 and v2 APIs. */
export class OpenCodeMessageApi {
  constructor(
    private readonly http: OpenCodeHttpClient,
    private readonly apiVersion: OpenCodeApiVersion,
  ) {}

  async list(sessionId: string, allPages = true, signal?: AbortSignal): Promise<OpenCodeMessage[]> {
    const route = this.apiVersion === "v2" ? "/api/session" : "/session";
    const sessionRoute = `${route}/${encodeURIComponent(sessionId)}/message`;
    const requestOptions = signal ? { signal } : {};
    if (this.apiVersion === "v1") {
      const rows = await this.http.request(`${sessionRoute}?limit=${OPENCODE_MESSAGE_LIMIT}`, undefined, requestOptions);
      return Array.isArray(rows) ? rows.flatMap((item) => {
        const message = parseOpenCodeMessage(item);
        return message ? [message] : [];
      }) : [];
    }

    const messages: JsonObject[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: String(OPENCODE_MESSAGE_LIMIT) });
      // OpenCode v2 cursors already encode the order and reject an explicit order alongside them.
      if (!cursor) query.set("order", allPages ? "asc" : "desc");
      if (cursor) query.set("cursor", cursor);
      const value = await this.http.request(`${sessionRoute}?${query}`, undefined, requestOptions);
      messages.push(...dataArray(value).map(asObject).filter((item): item is JsonObject => Boolean(item)));
      const nextCursor = allPages ? firstString(asObject(asObject(value)?.cursor)?.next) : undefined;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (allPages);

    const orderedMessages = allPages ? messages : messages.reverse();
    return orderedMessages.map(normalizeV2Message);
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function dataArray(value: unknown): unknown[] {
  const data = asObject(value)?.data;
  return Array.isArray(data) ? data : [];
}
