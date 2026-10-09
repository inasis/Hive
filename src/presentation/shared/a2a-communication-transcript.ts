import type { TranscriptEntry } from "./bridge";
import type { A2ACommunicationSummaryItemDto } from "../../application/dto/a2a-communication.js";
import { a2aCommunicationGroupKey, toA2ACommunicationSummaryItemDto } from "../../application/mappers/a2a-communication-mapper.js";

export type CachedA2ACommunicationSummary = {
  summaryId: string;
  communications: A2ACommunicationSummaryItemDto[];
  responseTurnId?: string;
  createdAt?: number;
  updatedAt?: number;
};

/** Restore cached A2A summaries over provider history without showing legacy requests as user chat. */
export function mergeA2ACommunicationSummaries(
  entries: TranscriptEntry[],
  summaries: readonly CachedA2ACommunicationSummary[],
): TranscriptEntry[] {
  return [...summaries]
    .sort((left, right) => summaryCreatedAt(left) - summaryCreatedAt(right))
    .reduce((current, summary) =>
      upsertA2ACommunicationEntry(current, summary.communications, summary.responseTurnId, summaryCreatedAt(summary)), entries);
}

/** Merge partial A2A events and replace legacy plain-text request entries with their communication card. */
export function upsertA2ACommunicationEntry(
  entries: TranscriptEntry[],
  communications: A2ACommunicationSummaryItemDto[],
  responseTurnId?: string,
  createdAt?: number,
): TranscriptEntry[] {
  if (!communications.length) return entries;
  const taskIds = new Set(communications.map((communication) => communication.taskId));
  const relatedEntries = entries.filter((entry) => entry.role === "communication" &&
    entry.communications?.some((communication) => taskIds.has(communication.taskId)));
  const mergedCommunications = new Map<string, A2ACommunicationSummaryItemDto>();
  for (const entry of relatedEntries) {
    for (const communication of entry.communications ?? []) {
      mergedCommunications.set(JSON.stringify([communication.taskId, communication.kind]), toA2ACommunicationSummaryItemDto(communication));
    }
  }
  for (const communication of communications) {
    mergedCommunications.set(JSON.stringify([communication.taskId, communication.kind]), communication);
  }
  const merged = [...mergedCommunications.values()];
  const relatedIds = new Set(relatedEntries.map((entry) => entry.id));
  const requestCounts = new Map<string, number>();
  const countedRequests = new Set<string>();
  for (const communication of merged) {
    if (communication.kind !== "request") continue;
    const requestKey = JSON.stringify([communication.taskId, communication.message.trim()]);
    if (countedRequests.has(requestKey)) continue;
    countedRequests.add(requestKey);
    const text = communication.message.trim();
    requestCounts.set(text, (requestCounts.get(text) ?? 0) + 1);
  }

  const removedUserIds = new Set<string>();
  const removedUserEntries: TranscriptEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.role !== "user") continue;
    const matchedText = [...requestCounts.keys()].find((text) =>
      (requestCounts.get(text) ?? 0) > 0 && isLegacyA2ARequestEntry(entry.text, text));
    if (!matchedText) continue;
    requestCounts.set(matchedText, requestCounts.get(matchedText)! - 1);
    removedUserIds.add(entry.id);
    removedUserEntries.push(entry);
  }

  const legacyRequestAnchorIndexes = entries.flatMap((entry, index) => removedUserIds.has(entry.id) ? [index] : []);
  const linkedAnchorIndexes: number[] = [];
  const toolCallIndex = findCommunicationToolCallIndex(entries, merged);
  if (toolCallIndex >= 0) linkedAnchorIndexes.push(toolCallIndex + 1);
  if (responseTurnId) {
    const assistantTurnIndex = entries.findIndex((entry) => entry.role === "assistant" && entry.turnId === responseTurnId);
    if (assistantTurnIndex >= 0) linkedAnchorIndexes.push(assistantTurnIndex);
  }
  const summaryAt = minimumTimestamp(
    earliestCommunicationCreatedAt(merged),
    createdAt,
    earliestEntryCreatedAt(relatedEntries),
  );
  const timestampAnchorIndex = summaryAt === undefined ? -1 : entries.findIndex((entry) =>
    !relatedIds.has(entry.id) && !removedUserIds.has(entry.id) &&
    typeof entry.createdAt === "number" &&
    (entry.createdAt > summaryAt || (entry.createdAt === summaryAt && entry.role !== "user")));
  const hasIndependentTimestampedEntries = entries.some((entry) =>
    !relatedIds.has(entry.id) && !removedUserIds.has(entry.id) &&
    typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt));
  const relatedAnchorIndex = entries.findIndex((entry) => relatedIds.has(entry.id));
  let anchorIndex = -1;
  if (legacyRequestAnchorIndexes.length > 0) {
    anchorIndex = Math.min(...legacyRequestAnchorIndexes);
  } else if (summaryAt !== undefined && hasIndependentTimestampedEntries) {
    // A matching turn/tool call may be much later than an async task's creation time.
    // Timestamp order is authoritative when the surrounding transcript has timestamps.
    anchorIndex = timestampAnchorIndex >= 0 ? timestampAnchorIndex : entries.length;
  } else if (relatedAnchorIndex >= 0) {
    anchorIndex = relatedAnchorIndex;
  } else if (linkedAnchorIndexes.length > 0) {
    anchorIndex = Math.min(...linkedAnchorIndexes);
  }
  const id = `a2a-summary:${a2aCommunicationGroupKey(merged)}`;
  const turnId = responseTurnId ?? relatedEntries.find((entry) => entry.turnId)?.turnId ?? removedUserEntries.at(-1)?.turnId;
  const summary: TranscriptEntry = {
    id,
    role: "communication",
    text: "",
    ...(turnId ? { turnId } : {}),
    ...(summaryAt !== undefined ? { createdAt: summaryAt } : {}),
    communications: merged,
  };
  const output: TranscriptEntry[] = [];
  let inserted = false;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (!inserted && index === anchorIndex) {
      output.push(summary);
      inserted = true;
    }
    if (relatedIds.has(entry.id) || removedUserIds.has(entry.id)) continue;
    output.push(entry);
  }
  if (!inserted) output.push(summary);
  return output;
}

function summaryCreatedAt(summary: CachedA2ACommunicationSummary): number {
  return summary.createdAt ?? earliestCommunicationCreatedAt(summary.communications) ?? summary.updatedAt ?? 0;
}

function earliestCommunicationCreatedAt(communications: readonly A2ACommunicationSummaryItemDto[]): number | undefined {
  const timestamps = communications.flatMap(({ createdAt }) =>
    typeof createdAt === "number" && Number.isFinite(createdAt) ? [createdAt] : []);
  return timestamps.length ? Math.min(...timestamps) : undefined;
}

function earliestEntryCreatedAt(entries: readonly TranscriptEntry[]): number | undefined {
  const timestamps = entries.flatMap(({ createdAt }) =>
    typeof createdAt === "number" && Number.isFinite(createdAt) ? [createdAt] : []);
  return timestamps.length ? Math.min(...timestamps) : undefined;
}

function minimumTimestamp(...timestamps: Array<number | undefined>): number | undefined {
  const present = timestamps.filter((timestamp): timestamp is number =>
    typeof timestamp === "number" && Number.isFinite(timestamp));
  return present.length ? Math.min(...present) : undefined;
}

function findCommunicationToolCallIndex(entries: TranscriptEntry[], communications: A2ACommunicationSummaryItemDto[]): number {
  const taskIds = new Set(communications.filter((communication) => communication.kind === "request")
    .map((communication) => communication.taskId));
  if (!taskIds.size) return -1;

  return entries.findIndex((entry) => {
    if (entry.role !== "tool" || !/\ba2[ab]_send\b/i.test(`${entry.text} ${entry.command ?? ""}`)) return false;
    const output = entry.output ?? "";
    return [...taskIds].some((taskId) => output.includes(taskId));
  });
}

function isLegacyA2ARequestEntry(text: string, request: string): boolean {
  const normalized = text.trim();
  if (normalized === request) return true;
  const promptPrefix = "Handle one Hive A2A task in a fresh session.";
  const requestMarker = "\nRequest:";
  const markerIndex = normalized.lastIndexOf(requestMarker);
  return normalized.startsWith(promptPrefix) && markerIndex >= 0 &&
    normalized.slice(markerIndex + requestMarker.length).trim() === request;
}
