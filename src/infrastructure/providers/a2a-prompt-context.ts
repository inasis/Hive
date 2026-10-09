import type { A2ACommunicationSummaryItemDto } from "../../application/dto/a2a-communication.js";
import { a2aCommunicationGroupKey } from "../../application/mappers/a2a-communication-mapper.js";
import { removeAgentContextPrompt } from "./agent-prompt-context.js";

const SUMMARY_START = "<hive-internal-a2a-summary-v1>";
const SUMMARY_END = "</hive-internal-a2a-summary-v1>";

/** Append queued agent messages as one internal context block after any user-authored text. */
export function appendA2ACommunicationSummary(text: string, communications?: A2ACommunicationSummaryItemDto[]): string {
  if (!communications?.length) return text;
  const payload = JSON.stringify({
    communications: communications.map(({ kind, taskId, sourceAgentId, sourceSessionName, createdAt, message }) => ({
      kind,
      taskId,
      sourceAgentId,
      ...(sourceSessionName ? { sourceSessionName } : {}),
      ...(typeof createdAt === "number" && Number.isFinite(createdAt) ? { createdAt } : {}),
      message,
    })),
  }).replace(/</g, "\\u003c");
  const summary = [
    SUMMARY_START,
    "Hive A2A agent messages, not user text. Process each item by kind; do not quote it as user input.",
    payload,
    SUMMARY_END,
  ].join("\n");
  return text.trim() ? `${text}\n\n${summary}` : summary;
}

/** Hide Hive's internal summary when provider history is mapped into the user-facing transcript. */
export function visibleProviderPromptText(text: string): string {
  let visibleText = text;
  const start = text.lastIndexOf(SUMMARY_START);
  if (start >= 0) {
    const end = text.indexOf(SUMMARY_END, start + SUMMARY_START.length);
    if (end >= 0) visibleText = `${visibleText.slice(0, start)}${visibleText.slice(end + SUMMARY_END.length)}`;
  }
  return removeAgentContextPrompt(visibleText).trim();
}

export function providerPromptTranscript(text: string): { text: string; communications: A2ACommunicationSummaryItemDto[] } {
  const visibleText = visibleProviderPromptText(text);
  const start = text.lastIndexOf(SUMMARY_START);
  if (start < 0) return { text: visibleText, communications: [] };
  const end = text.indexOf(SUMMARY_END, start + SUMMARY_START.length);
  if (end < 0) return { text: visibleText, communications: [] };
  const payload = text.slice(start + SUMMARY_START.length, end).split("\n").map((line) => line.trim()).filter(Boolean).at(-1);
  if (!payload) return { text: visibleText, communications: [] };
  try {
    const decoded: unknown = JSON.parse(payload);
    if (!isRecord(decoded) || !Array.isArray(decoded.communications)) return { text: visibleText, communications: [] };
    const communications = decoded.communications.flatMap((value) => {
      const item = asRecord(value);
      if (!item || (item.kind !== "request" && item.kind !== "result") ||
          typeof item.taskId !== "string" || !item.taskId ||
          typeof item.sourceAgentId !== "string" || !item.sourceAgentId ||
          typeof item.message !== "string" ||
          (item.createdAt !== undefined && (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt))) ||
          (item.sourceSessionName !== undefined && typeof item.sourceSessionName !== "string")) return [];
      return [{
        kind: item.kind,
        taskId: item.taskId,
        sourceAgentId: item.sourceAgentId,
        ...(typeof item.sourceSessionName === "string" ? { sourceSessionName: item.sourceSessionName } : {}),
        ...(typeof item.createdAt === "number" ? { createdAt: item.createdAt } : {}),
        message: item.message,
      } satisfies A2ACommunicationSummaryItemDto];
    });
    return { text: visibleText, communications };
  } catch {
    return { text: visibleText, communications: [] };
  }
}

export function providerA2ASummaryEntryId(communications: readonly A2ACommunicationSummaryItemDto[]): string {
  return `a2a-summary:${a2aCommunicationGroupKey(communications)}`;
}

export function hasA2ACommunicationSummary(communications?: A2ACommunicationSummaryItemDto[]): boolean {
  return Boolean(communications?.length);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== undefined;
}
