import type { TranscriptEntry } from "../../shared/bridge";

export type ThreadActivityState = {
  running: boolean;
  turnId: string | undefined;
};

/** Infer the active turn restored from a conversation transcript. */
export function resolveThreadActivity(
  entries: TranscriptEntry[],
  fallbackTurnId: string | undefined,
): ThreadActivityState {
  const latestUserIndex = lastIndex(entries, (entry) => entry.role === "user");
  const latestAssistantIndex = lastIndex(entries, (entry) => entry.role === "assistant");
  const activeEntry = activeTranscriptEntry(entries, latestUserIndex);
  const hasUnansweredUser = latestUserIndex >= 0 &&
    latestUserIndex > latestAssistantIndex &&
    latestUserIndex === entries.length - 1;
  const running = Boolean(activeEntry) || hasUnansweredUser;
  const latestUserTurnId = lastEntry(entries, (entry) => entry.role === "user" && Boolean(entry.turnId))?.turnId;

  return {
    running,
    turnId: activeEntry?.turnId ?? latestUserTurnId ?? fallbackTurnId,
  };
}

function activeTranscriptEntry(entries: TranscriptEntry[], latestUserIndex: number): TranscriptEntry | undefined {
  for (let index = entries.length - 1; index >= 0 && index >= latestUserIndex; index -= 1) {
    const entry = entries[index]!;
    if (entry.role === "assistant" && (entry.responseCompleted === false || isRunningStatus(entry.status))) return entry;
    if (entry.role === "tool" && isRunningStatus(entry.status)) return entry;
  }
  return undefined;
}

function lastEntry<T>(entries: T[], predicate: (entry: T) => boolean): T | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (predicate(entry)) return entry;
  }
  return undefined;
}

function lastIndex<T>(entries: T[], predicate: (entry: T) => boolean): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (predicate(entries[index]!)) return index;
  }
  return -1;
}

function isRunningStatus(status: string | undefined): boolean {
  return status === "inProgress" || status === "in_progress" || status === "running" || status === "started" || status === "pending";
}
