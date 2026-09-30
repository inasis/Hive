import type { TranscriptEntry } from "../../../../../src/domain/assistant.js";
import { asRecord, displayValue, stringValue } from "./bridge-event-values.js";

export type TranscriptEventUpdate =
  | { type: "transcriptEntriesUpdated"; entries: TranscriptEntry[]; replaceIdPrefix?: string }
  | { type: "assistantMessageCompleted"; turnId: string; messageId: string; text: string };

/** Map provider transcript item payloads to UI entries without exposing their protocol DTOs. */
export function mapTranscriptItemStarted(value: unknown): TranscriptEventUpdate | undefined {
  const item = asRecord(value) ?? {};
  const id = stringValue(item.id) ?? `item-${Date.now()}`;
  if (item.type === "commandExecution") {
    return { type: "transcriptEntriesUpdated", entries: [{
      id,
      role: "tool",
      text: "실행 중",
      toolType: "commandExecution",
      command: displayValue(item.command),
      output: "",
      status: "inProgress",
    }] };
  }
  if (item.type === "fileChange") {
    return { type: "transcriptEntriesUpdated", entries: [{ id, role: "change", text: "파일 변경 준비 중", status: "inProgress" }] };
  }
  if (item.type === "webSearch") return webSearchUpdate(item, id, "inProgress");
  return undefined;
}

export function mapTranscriptItemCompleted(value: unknown, params: Record<string, unknown>): TranscriptEventUpdate | undefined {
  const item = asRecord(value);
  const id = stringValue(item?.id);
  if (!item || !id) return undefined;
  if (item.type === "commandExecution") {
    return { type: "transcriptEntriesUpdated", entries: [{
      id,
      role: "tool",
      text: stringValue(item.status) ?? "완료",
      toolType: "commandExecution",
      command: displayValue(item.command),
      output: stringValue(item.aggregatedOutput) ?? stringValue(item.output) ?? "",
      status: stringValue(item.status) ?? "completed",
    }] };
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const summary = changes.map((change) => stringValue(asRecord(change)?.path)).filter((path): path is string => Boolean(path)).join("\n") || "변경된 파일";
    return { type: "transcriptEntriesUpdated", entries: [{ id, role: "change", text: summary, status: stringValue(item.status) ?? "completed" }] };
  }
  if (item.type === "webSearch") return webSearchUpdate(item, id, stringValue(item.status) ?? "completed");
  if (item.type === "agentMessage") {
    const text = stringValue(item.text) ?? contentText(item.content);
    if (!text) return undefined;
    return {
      type: "assistantMessageCompleted",
      turnId: stringValue(params.turnId) ?? "turn",
      messageId: id,
      text,
    };
  }
  return undefined;
}

function webSearchUpdate(item: Record<string, unknown>, id: string, status: string): Extract<TranscriptEventUpdate, { type: "transcriptEntriesUpdated" }> {
  const action = asRecord(item.action);
  const queries = Array.isArray(action?.queries)
    ? action.queries.flatMap((query) => typeof query === "string" && query.trim() ? [query.trim()] : [])
    : [];
  const searchQueries = queries.length ? queries : [stringValue(action?.query) ?? stringValue(item.query) ?? ""];
  const entries: TranscriptEntry[] = searchQueries.map((query, index) => ({
    id: searchQueries.length > 1 ? `${id}:query:${index + 1}` : id,
    role: "tool",
    text: "WebSearch",
    toolType: "webSearch",
    command: query || "검색 준비 중",
    output: stringValue(item.result) ?? stringValue(item.content) ?? "",
    status,
  }));
  return { type: "transcriptEntriesUpdated", entries, replaceIdPrefix: id };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : stringValue(asRecord(part)?.text) ?? "").filter(Boolean).join("\n");
}
