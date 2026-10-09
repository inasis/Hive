import type { AssistantToolActivity } from "../../../application/ports/events.js";

type JsonObject = Record<string, unknown>;

/** Maps Codex protocol tool items to provider-neutral assistant activity. */
export function mapCodexToolActivity(item: JsonObject): AssistantToolActivity | undefined {
  const id = firstString(item.id);
  const status = firstString(item.status);
  if (item.type === "commandExecution") return {
    kind: "commandExecution",
    ...(id ? { id } : {}),
    command: displayValue(item.command),
    ...(firstString(item.aggregatedOutput, item.output) ? { output: firstString(item.aggregatedOutput, item.output)! } : {}),
    ...(status ? { status } : {}),
  };
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return {
      kind: "fileChange",
      ...(id ? { id } : {}),
      paths: changes.flatMap((change) => firstString(asObject(change)?.path) ? [firstString(asObject(change)?.path)!] : []),
      ...(status ? { status } : {}),
    };
  }
  if (item.type === "webSearch") {
    const action = asObject(item.action);
    const queries = Array.isArray(action?.queries)
      ? action.queries.flatMap((query) => typeof query === "string" && query.trim() ? [query.trim()] : [])
      : [];
    return {
      kind: "webSearch",
      ...(id ? { id } : {}),
      queries: queries.length ? queries : [firstString(action?.query, item.query) ?? ""],
      ...(firstString(item.result, item.content) ? { output: firstString(item.result, item.content)! } : {}),
      ...(status ? { status } : {}),
    };
  }
  return undefined;
}

function displayValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) return value.map((part) => String(part)).join(" ");
  return "(unavailable)";
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
