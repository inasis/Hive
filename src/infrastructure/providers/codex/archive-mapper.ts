import type { CodexArchiveJsonObject, CodexArchiveJsonValue } from "../../../application/ports/codex-cli.js";

/** Validate opaque app-server history as JSON before it crosses into the archive use case. */
export function toCodexArchiveJsonObject(value: unknown): CodexArchiveJsonObject {
  const parsed = toJsonValue(value, "$threadRead");
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex returned an invalid thread/read archive payload");
  }
  return parsed;
}

function toJsonValue(value: unknown, path: string): CodexArchiveJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => [key, toJsonValue(item, `${path}.${key}`)] as const);
    return Object.fromEntries(entries) as CodexArchiveJsonObject;
  }
  throw new Error(`Codex returned a non-JSON value in thread/read archive payload at ${path}`);
}
