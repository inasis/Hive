import type { TranscriptEntry } from "../../../domain/assistant.js";
import { providerA2ASummaryEntryId, providerPromptTranscript } from "../a2a-prompt-context.js";

/** Convert Hive's internal A2A prompt block into visible Kiro transcript entries. */
export function mapKiroPromptTranscriptEntries(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  return entries.flatMap((entry) => {
    if (entry.role !== "user") return [entry];
    const prompt = providerPromptTranscript(entry.text);
    const communicationTimestamps = prompt.communications.flatMap(({ createdAt }) =>
      typeof createdAt === "number" && Number.isFinite(createdAt) ? [createdAt] : []);
    const createdAt = communicationTimestamps.length ? Math.min(...communicationTimestamps) : entry.createdAt;
    return [
      ...(prompt.text ? [{ ...entry, text: prompt.text }] : []),
      ...(prompt.communications.length ? [{
        id: providerA2ASummaryEntryId(prompt.communications),
        role: "communication" as const,
        text: "",
        ...(createdAt !== undefined ? { createdAt } : {}),
        ...(entry.turnId ? { turnId: entry.turnId } : {}),
        communications: prompt.communications,
      }] : []),
    ];
  });
}
