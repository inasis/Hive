import type { OpenCodeApiVersion } from "./api.js";
import type { OpenCodeCommand, OpenCodeSkill } from "./types.js";

type JsonObject = Record<string, unknown>;

/** Normalize v1/v2 skill catalog responses to the provider adapter's internal model. */
export function parseOpenCodeSkills(value: unknown, apiVersion: OpenCodeApiVersion): OpenCodeSkill[] {
  const record = asObject(value);
  const rows = apiVersion === "v2"
    ? dataArray(value)
    : Array.isArray(value) ? value : Array.isArray(record?.skills) ? record.skills : dataArray(value);
  return rows.flatMap((rowValue) => {
    if (typeof rowValue === "string" && rowValue.trim()) {
      return [{ id: rowValue, name: rowValue, description: "", path: "", content: "", enabled: true }];
    }
    const row = asObject(rowValue);
    const id = firstString(row?.id, row?.name);
    if (!row || !id || isSlashSkillDisabled(typeof row.content === "string" ? row.content : "")) return [];
    return [{
      id,
      name: firstString(row.name, id) ?? id,
      description: firstString(row.description) ?? "",
      path: firstString(row.path) ?? "",
      content: typeof row.content === "string" ? row.content : "",
      enabled: row.enabled !== false,
    }];
  });
}

/** Normalize v1/v2 command catalog responses to the provider adapter's internal model. */
export function parseOpenCodeCommands(value: unknown, apiVersion: OpenCodeApiVersion): OpenCodeCommand[] {
  const record = asObject(value);
  const rows = apiVersion === "v2"
    ? dataArray(value)
    : Array.isArray(value) ? value : Array.isArray(record?.commands) ? record.commands : [];
  return rows.flatMap((rowValue) => {
    const row = asObject(rowValue);
    const name = firstString(row?.name);
    return row && name ? [{ name, description: firstString(row.description) ?? "" }] : [];
  });
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function dataArray(value: unknown): unknown[] {
  const data = asObject(value)?.data;
  return Array.isArray(data) ? data : [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function isSlashSkillDisabled(content: string): boolean {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? "";
  const slash = /^slash:\s*(?:["']?(false|true)["']?)\s*$/im.exec(frontmatter)?.[1];
  const metadataSlash = /^\s+opencode\/slash:\s*(?:["']?(false|true)["']?)\s*$/im.exec(frontmatter)?.[1];
  return slash?.toLowerCase() === "false" || metadataSlash?.toLowerCase() === "false";
}
