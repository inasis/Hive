import type { TranscriptEntry } from "../../../domain/assistant.js";
import { asObject, firstString } from "./protocol-utils.js";
import { mapCodexHistoryItem } from "./codex-history-item-mapper.js";

type JsonObject = Record<string, unknown>;

/** Convert Codex thread/read history into provider-neutral transcript entries. */
export function mapCodexTranscript(thread: JsonObject): TranscriptEntry[] {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const entries: TranscriptEntry[] = [];
  for (const turnValue of turns) {
    const turn = asObject(turnValue);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    const turnCreatedAt = timestampMillis(turn?.startedAt ?? turn?.createdAt);
    const firstTurnEntry = entries.length;
    const turnId = firstString(turn?.id);
    const turnStatus = firstString(turn?.status) ?? "completed";
    for (const itemValue of items) {
      const item = asObject(itemValue);
      if (!item) continue;
      const id = firstString(item.id) ?? `entry-${entries.length}`;
      entries.push(...mapCodexHistoryItem(item, id, { ...(turnId ? { turnId } : {}), turnStatus }));
    }
    if (turnCreatedAt !== undefined) {
      for (let index = firstTurnEntry; index < entries.length; index += 1) {
        const entry = entries[index]!;
        if (entry.createdAt === undefined) entries[index] = { ...entry, createdAt: turnCreatedAt };
      }
    }
  }
  return entries;
}

function timestampMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value < 100_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
