import type { TranscriptEntry } from "../../../domain/assistant.js";
import { providerA2ASummaryEntryId, providerPromptTranscript } from "../a2a-prompt-context.js";
import { asObject, firstString } from "./protocol-utils.js";

type JsonObject = Record<string, unknown>;

type CodexHistoryTurnContext = {
  turnId?: string;
  turnStatus: string;
};

/** Convert one concrete Codex history item into provider-neutral transcript entries. */
export function mapCodexHistoryItem(
  item: JsonObject,
  id: string,
  turn: CodexHistoryTurnContext,
): TranscriptEntry[] {
  const type = firstString(item.type) ?? "";
  if (type === "userMessage") {
    const prompt = providerPromptTranscript(contentText(item.content));
    const promptCreatedAt = earliestCommunicationCreatedAt(prompt.communications);
    const entries: TranscriptEntry[] = [];
    if (prompt.text) entries.push({ id, role: "user", text: prompt.text, ...(turn.turnId ? { turnId: turn.turnId } : {}) });
    if (prompt.communications.length) entries.push({
      id: providerA2ASummaryEntryId(prompt.communications),
      role: "communication",
      text: "",
      ...(promptCreatedAt !== undefined ? { createdAt: promptCreatedAt } : {}),
      ...(turn.turnId ? { turnId: turn.turnId } : {}),
      communications: prompt.communications,
    });
    return entries;
  }
  if (type === "agentMessage") {
    const text = firstString(item.text) ?? contentText(item.content);
    if (!text) return [];
    const sourceMessageId = firstString(item.id);
    return [{
      id,
      role: "assistant",
      text,
      ...(turn.turnId ? { turnId: turn.turnId } : {}),
      ...(sourceMessageId ? { providerMessageId: sourceMessageId } : {}),
      responseCompleted: !["inProgress", "in_progress", "running", "started"].includes(turn.turnStatus),
    }];
  }
  if (type === "commandExecution") {
    return [{
      id,
      role: "tool",
      text: firstString(item.status) ?? "command",
      toolType: "commandExecution",
      command: firstString(item.command) ?? "",
      output: firstString(item.aggregatedOutput, item.output) ?? "",
      status: firstString(item.status) ?? "completed",
    }];
  }
  if (type === "fileChange") {
    return [{
      id,
      role: "change",
      text: fileChangeSummary(item),
      status: firstString(item.status) ?? "completed",
    }];
  }
  if (type === "webSearch") return webSearchTranscriptEntries(item, id);
  if (type === "mcpToolCall") {
    return [{
      id,
      role: "tool",
      text: firstString(item.tool, item.name, type) ?? type,
      toolType: "mcpToolCall",
      command: firstString(item.server, item.query, item.arguments) ?? "",
      output: firstString(item.result, item.content) ?? "",
      status: firstString(item.status) ?? "completed",
    }];
  }
  return [];
}

function webSearchTranscriptEntries(item: JsonObject, id: string): TranscriptEntry[] {
  const action = asObject(item.action);
  const queries = Array.isArray(action?.queries)
    ? action.queries.flatMap((query) => typeof query === "string" && query.trim() ? [query.trim()] : [])
    : [];
  const searchQueries = queries.length ? queries : [firstString(action?.query, item.query) ?? ""];
  const status = firstString(item.status) ?? "completed";
  return searchQueries.map((query, index) => ({
    id: searchQueries.length > 1 ? `${id}:query:${index + 1}` : id,
    role: "tool",
    text: "WebSearch",
    toolType: "webSearch",
    command: query || "웹 검색",
    output: firstString(item.result, item.content) ?? "",
    status,
  }));
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((partValue) => {
    if (typeof partValue === "string") return partValue;
    const part = asObject(partValue);
    return firstString(part?.text, part?.inputText, part?.outputText) ?? "";
  }).filter(Boolean).join("\n");
}

function fileChangeSummary(item: JsonObject): string {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const paths = changes.map((change) => firstString(asObject(change)?.path)).filter(Boolean);
  return paths.length ? paths.join("\n") : "File changes";
}

function earliestCommunicationCreatedAt(communications: readonly { createdAt?: number }[]): number | undefined {
  const timestamps = communications.flatMap(({ createdAt }) =>
    typeof createdAt === "number" && Number.isFinite(createdAt) ? [createdAt] : []);
  return timestamps.length ? Math.min(...timestamps) : undefined;
}
