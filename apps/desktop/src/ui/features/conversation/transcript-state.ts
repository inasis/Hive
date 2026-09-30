import type { TranscriptEntry } from "../../../shared/bridge";
import { groupTranscriptResponses, type TranscriptResponseGroup } from "../../shared/transcript-groups";

type TranscriptBlock =
  | { kind: "entry"; entry: TranscriptEntry }
  | { kind: "activity"; id: string; entries: TranscriptEntry[] };
export { groupTranscriptResponses, type TranscriptResponseGroup };

export function groupTranscriptEntries(entries: TranscriptEntry[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (let index = 0; index < entries.length;) {
    const entry = entries[index]!;
    if (entry.role !== "tool" && entry.role !== "change") {
      blocks.push({ kind: "entry", entry });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < entries.length && (entries[end]!.role === "tool" || entries[end]!.role === "change")) end += 1;
    const activity = entries.slice(index, end);
    blocks.push({ kind: "activity", id: entry.id, entries: activity });
    index = end;
  }
  return blocks;
}

export function appendAssistantDelta(entries: TranscriptEntry[], id: string, delta: string, turnId: string, providerMessageId: string): TranscriptEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) return [...entries, { id, role: "assistant", text: delta, turnId, providerMessageId, responseCompleted: false, status: "inProgress" }];
  return entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, text: entry.text + delta, turnId, providerMessageId, responseCompleted: false, status: "inProgress" } : entry);
}

export function canForkTranscriptEntry(entry: TranscriptEntry, responseComplete: boolean): boolean {
  if (entry.role !== "assistant" || entry.status === "inProgress" || !responseComplete) return false;
  return true;
}

export function assistantResponseTextForEntry(entry: TranscriptEntry, entries: TranscriptEntry[], threadIdle: boolean): string | undefined {
  if (entry.role !== "assistant" || entry.status === "inProgress") return undefined;
  const index = entries.findIndex((candidate) => candidate.id === entry.id);
  if (index < 0) return undefined;
  let start = index;
  while (start > 0 && entries[start - 1]?.role !== "user") start -= 1;
  let end = index + 1;
  while (end < entries.length && entries[end]?.role !== "user") end += 1;
  const responseEntries = entries.slice(start, end).filter((candidate) => candidate.role === "assistant");
  if (responseEntries.some((candidate) => candidate.status === "inProgress")) return undefined;
  if (responseEntries.at(-1)?.id !== entry.id) return undefined;
  const hasFollowingUserMessage = end < entries.length;
  if (!hasFollowingUserMessage && !threadIdle) return undefined;
  return responseEntries.map((candidate) => candidate.text).filter(Boolean).join("\n\n");
}

export function upsertEntry(entries: TranscriptEntry[], next: TranscriptEntry): TranscriptEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next];
  return entries.map((entry, entryIndex) => entryIndex === index ? next : entry);
}

/** Merge partial A2A events and replace legacy plain-text request entries with their communication card. */
export function replaceWebSearchEntries(entries: TranscriptEntry[], id: string, next: TranscriptEntry[]): TranscriptEntry[] {
  const isPreviousEntry = (entry: TranscriptEntry) => entry.id === id || entry.id.startsWith(`${id}:query:`);
  const firstIndex = entries.findIndex(isPreviousEntry);
  if (firstIndex < 0) return [...entries, ...next];
  const retainedBefore = entries.slice(0, firstIndex).filter((entry) => !isPreviousEntry(entry));
  const retainedAfter = entries.slice(firstIndex).filter((entry) => !isPreviousEntry(entry));
  return [...retainedBefore, ...next, ...retainedAfter];
}
