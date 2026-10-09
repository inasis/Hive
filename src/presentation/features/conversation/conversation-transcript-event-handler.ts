import type { AssistantProvider, TranscriptEntry } from "../../shared/bridge";
import type { UiBridgeEvent } from "../../shared/bridge-events";
import { upsertA2ACommunicationEntry } from "../../shared/a2a-communication-transcript";
import type { TranscriptCachePort } from "../../../application/ports/transcript-cache.js";
import { replaceWebSearchEntries, upsertEntry } from "./transcript-state";

type ThreadEntryUpdate = (current: TranscriptEntry[]) => TranscriptEntry[];

type TranscriptEventDependencies = {
  eventProvider: AssistantProvider;
  transcriptCache: TranscriptCachePort;
  actions: {
    updateThreadEntries(target: string, provider: AssistantProvider, threadId: string, update: ThreadEntryUpdate): void;
    flushAssistantDeltas(): void;
  };
};

/** Clear transcript state before turn handling, preserving the bridge event ordering policy. */
export function applyTranscriptClearedEvent(event: UiBridgeEvent, dependencies: TranscriptEventDependencies): boolean {
  if (event.type !== "transcriptCleared") return false;
  const { eventProvider, transcriptCache, actions } = dependencies;
  actions.updateThreadEntries(event.target, eventProvider, event.threadId, () => []);
  void transcriptCache.clearCommunicationSummaries(event.target, eventProvider, event.threadId);
  return true;
}

/** Apply transcript content events after the active-provider filter. */
export function applyTranscriptContentEvent(event: UiBridgeEvent, dependencies: TranscriptEventDependencies): boolean {
  const { eventProvider, transcriptCache, actions } = dependencies;
  if (event.type === "transcriptEntriesUpdated") {
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, (current) => event.replaceIdPrefix
      ? replaceWebSearchEntries(current, event.replaceIdPrefix, event.entries)
      : event.entries.reduce(upsertEntry, current));
    return true;
  }
  if (event.type === "a2aCommunicationSummary") {
    const responseTurnId = event.responseTurnId;
    if (responseTurnId) actions.flushAssistantDeltas();
    void transcriptCache.saveCommunicationSummary(event.target, eventProvider, event.threadId, event.summaryId, event.communications, responseTurnId);
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, (current) =>
      upsertA2ACommunicationEntry(current, event.communications, responseTurnId));
    return true;
  }
  if (event.type === "assistantMessageCompleted") {
    actions.flushAssistantDeltas();
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, (current) => {
      const messageId = `${event.turnId}:${event.messageId}`;
      const previousIndex = findAssistantMessageIndex(current, messageId, event.turnId, event.messageId);
      const previousEntry = previousIndex >= 0 ? current[previousIndex] : undefined;
      const streamedText = previousEntry?.text ?? "";
      const completedEntry: TranscriptEntry = {
        id: messageId,
        role: "assistant",
        text: streamedText.length > event.text.length ? streamedText : event.text,
        turnId: event.turnId,
        providerMessageId: event.messageId,
        createdAt: previousEntry?.createdAt ?? Date.now(),
        responseCompleted: false,
        status: "completed",
      };
      if (previousIndex < 0) return upsertEntry(current, completedEntry);
      return current.map((entry, index) => index === previousIndex ? completedEntry : entry);
    });
    return true;
  }
  return false;
}

function findAssistantMessageIndex(
  entries: TranscriptEntry[],
  messageId: string,
  turnId: string,
  providerMessageId: string,
): number {
  let providerMessageIndex = -1;
  let activeTurnMessageIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.role !== "assistant") continue;
    if (entry.id === messageId) return index;
    if (providerMessageIndex < 0 && entry.turnId === turnId && entry.providerMessageId === providerMessageId) providerMessageIndex = index;
    if (activeTurnMessageIndex < 0 && entry.turnId === turnId && entry.status === "inProgress") activeTurnMessageIndex = index;
  }
  return providerMessageIndex >= 0 ? providerMessageIndex : activeTurnMessageIndex;
}
