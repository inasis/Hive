import type { TranscriptEntry } from "../../../domain/assistant.js";

type JsonObject = Record<string, unknown>;

/** Convert Codex thread/read history into provider-neutral transcript entries. */
export function mapCodexTranscript(thread: JsonObject): TranscriptEntry[] {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const entries: TranscriptEntry[] = [];
  for (const turnValue of turns) {
    const turn = asObject(turnValue);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const itemValue of items) {
      const item = asObject(itemValue);
      if (!item) continue;
      const id = firstString(item.id) ?? `entry-${entries.length}`;
      const type = firstString(item.type) ?? "";
      if (type === "userMessage") {
        const text = contentText(item.content);
        if (text) entries.push({ id, role: "user", text });
      } else if (type === "agentMessage") {
        const text = firstString(item.text) ?? contentText(item.content);
        const sourceMessageId = firstString(item.id);
        const turnId = firstString(turn?.id);
        const turnStatus = firstString(turn?.status) ?? "completed";
        if (text) entries.push({
          id,
          role: "assistant",
          text,
          ...(turnId ? { turnId } : {}),
          ...(sourceMessageId ? { providerMessageId: sourceMessageId } : {}),
          responseCompleted: !["inProgress", "in_progress", "running", "started"].includes(turnStatus),
        });
      } else if (type === "commandExecution") {
        entries.push({
          id,
          role: "tool",
          text: firstString(item.status) ?? "command",
          toolType: "commandExecution",
          command: firstString(item.command) ?? "",
          output: firstString(item.aggregatedOutput, item.output) ?? "",
          status: firstString(item.status) ?? "completed",
        });
      } else if (type === "fileChange") {
        entries.push({
          id,
          role: "change",
          text: fileChangeSummary(item),
          status: firstString(item.status) ?? "completed",
        });
      } else if (type === "webSearch") {
        entries.push(...webSearchTranscriptEntries(item, id));
      } else if (type === "mcpToolCall") {
        entries.push({
          id,
          role: "tool",
          text: firstString(item.tool, item.name, type) ?? type,
          toolType: "mcpToolCall",
          command: firstString(item.server, item.query, item.arguments) ?? "",
          output: firstString(item.result, item.content) ?? "",
          status: firstString(item.status) ?? "completed",
        });
      }
    }
  }
  return entries;
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

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
