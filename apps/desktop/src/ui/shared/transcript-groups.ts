import type { TranscriptEntry } from "../../shared/bridge";

export type TranscriptResponseGroup = { id: string; entries: TranscriptEntry[] };

/** Group ordinary turns by user prompt and autonomous turns by assistant turn ID. */
export function groupTranscriptResponses(entries: TranscriptEntry[]): TranscriptResponseGroup[] {
  const groups: TranscriptResponseGroup[] = [];
  let current: TranscriptEntry[] = [];
  let currentHasUser = false;
  let currentAssistantTurnId: string | undefined;
  let currentHasAssistant = false;

  const flush = () => {
    if (!current.length) return;
    groups.push({ id: current[0]!.id, entries: current });
    current = [];
    currentHasUser = false;
    currentAssistantTurnId = undefined;
    currentHasAssistant = false;
  };

  for (const entry of entries) {
    if (entry.role === "user") {
      flush();
      current.push(entry);
      currentHasUser = true;
      continue;
    }

    if (entry.role === "communication" && !currentHasUser && currentHasAssistant &&
        (!entry.turnId || !currentAssistantTurnId || entry.turnId !== currentAssistantTurnId)) {
      flush();
    }

    if (!currentHasUser && entry.role === "assistant" && currentHasAssistant) {
      const sameTurn = Boolean(entry.turnId && currentAssistantTurnId && entry.turnId === currentAssistantTurnId);
      if (!sameTurn) flush();
    }

    current.push(entry);
    if (entry.role === "assistant") {
      currentHasAssistant = true;
      currentAssistantTurnId ??= entry.turnId;
    }
  }
  flush();
  return groups;
}

export function latestTranscriptEntries(entries: TranscriptEntry[], groupLimit: number): TranscriptEntry[] {
  return groupTranscriptResponses(entries)
    .slice(-groupLimit)
    .flatMap((group) => group.entries);
}
