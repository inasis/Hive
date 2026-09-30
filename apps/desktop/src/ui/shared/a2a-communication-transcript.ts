import type { TranscriptEntry } from "../../shared/bridge";
import { a2aCommunicationGroupKey, type A2ACommunicationSummaryItem } from "../../../../../src/domain/a2a.js";

export type CachedA2ACommunicationSummary = {
  summaryId: string;
  communications: A2ACommunicationSummaryItem[];
  responseTurnId?: string;
  updatedAt?: number;
};

/** Restore cached A2A summaries over provider history without showing legacy requests as user chat. */
export function mergeA2ACommunicationSummaries(
  entries: TranscriptEntry[],
  summaries: readonly CachedA2ACommunicationSummary[],
): TranscriptEntry[] {
  return [...summaries]
    .sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0))
    .reduce((current, summary) =>
      upsertA2ACommunicationEntry(current, summary.communications, summary.responseTurnId), entries);
}

/** Merge partial A2A events and replace legacy plain-text request entries with their communication card. */
export function upsertA2ACommunicationEntry(
  entries: TranscriptEntry[],
  communications: A2ACommunicationSummaryItem[],
  responseTurnId?: string,
): TranscriptEntry[] {
  if (!communications.length) return entries;
  const taskIds = new Set(communications.map((communication) => communication.taskId));
  const relatedEntries = entries.filter((entry) => entry.role === "communication" &&
    entry.communications?.some((communication) => taskIds.has(communication.taskId)));
  const mergedCommunications = new Map<string, A2ACommunicationSummaryItem>();
  for (const entry of relatedEntries) {
    for (const communication of entry.communications ?? []) {
      mergedCommunications.set(JSON.stringify([communication.taskId, communication.kind]), communication);
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

  const anchorIndexes = entries.flatMap((entry, index) =>
    relatedIds.has(entry.id) || removedUserIds.has(entry.id) ? [index] : []);
  if (responseTurnId) {
    const assistantTurnIndex = entries.findIndex((entry) => entry.role === "assistant" && entry.turnId === responseTurnId);
    if (assistantTurnIndex >= 0) anchorIndexes.push(assistantTurnIndex);
  }
  const anchorIndex = anchorIndexes.length > 0 ? Math.min(...anchorIndexes) : -1;
  const id = `a2a-summary:${a2aCommunicationGroupKey(merged)}`;
  const turnId = responseTurnId ?? relatedEntries.find((entry) => entry.turnId)?.turnId ?? removedUserEntries.at(-1)?.turnId;
  const summary: TranscriptEntry = {
    id,
    role: "communication",
    text: "",
    ...(turnId ? { turnId } : {}),
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

function isLegacyA2ARequestEntry(text: string, request: string): boolean {
  const normalized = text.trim();
  if (normalized === request) return true;
  const promptPrefix = "Handle one Hive A2A task in a fresh session.";
  const requestMarker = "\nRequest:";
  const markerIndex = normalized.lastIndexOf(requestMarker);
  return normalized.startsWith(promptPrefix) && markerIndex >= 0 &&
    normalized.slice(markerIndex + requestMarker.length).trim() === request;
}
