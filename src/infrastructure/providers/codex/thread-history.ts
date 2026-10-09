type JsonObject = Record<string, unknown>;
type ThreadHistoryMethod = "thread/read" | "thread/turns/list";
type ThreadHistoryCall = (method: ThreadHistoryMethod, params: JsonObject) => Promise<unknown>;

/** Handles Codex thread metadata and full-history pagination protocol. */
export class CodexThreadHistory {
  constructor(private readonly call: ThreadHistoryCall) {}

  readMetadata(threadId: string): Promise<unknown> {
    return this.call("thread/read", { threadId, includeTurns: false });
  }

  async read(threadId: string): Promise<JsonObject> {
    const metadata = asObject(await this.readMetadata(threadId));
    const thread = asObject(metadata?.thread);
    if (!metadata || !thread) throw new Error("Codex returned an invalid thread/read response");

    if (thread.historyMode === "paginated") {
      const turns = await this.readPaginatedTurns(threadId);
      return { ...metadata, thread: { ...thread, turns } };
    }

    const completeResponse = await this.call("thread/read", { threadId, includeTurns: true });
    const complete = asObject(completeResponse);
    if (!complete || !asObject(complete.thread)) {
      throw new Error("Codex returned an invalid full-history response");
    }
    return complete;
  }

  private async readPaginatedTurns(threadId: string): Promise<JsonObject[]> {
    const turns = new Map<string, JsonObject>();
    const cursors = new Set<string>();
    let cursor: string | undefined;

    while (true) {
      const response = await this.call("thread/turns/list", {
        threadId,
        limit: 100,
        sortDirection: "asc",
        itemsView: "full",
        ...(cursor ? { cursor } : {}),
      });
      const record = asObject(response);
      const rows = Array.isArray(record?.data) ? record.data : [];
      for (const row of rows) {
        const turn = asObject(row);
        const id = firstString(turn?.id);
        if (turn && id) turns.set(id, turn);
      }

      const nextCursor = firstString(record?.nextCursor);
      if (!nextCursor || cursors.has(nextCursor)) break;
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    return [...turns.values()];
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
