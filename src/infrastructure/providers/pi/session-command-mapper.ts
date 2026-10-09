import { asObject } from "./session-json-values.js";

/** Maps Pi RPC command and skill descriptors into the provider's shared catalog shape. */
export function mapPiCommands(value: unknown): Array<{ name: string; description: string; source: string; location?: string }> {
  const rows = Array.isArray(value) ? value : [];
  return rows.flatMap((rowValue) => {
    const row = asObject(rowValue);
    if (!row || typeof row.name !== "string" || !row.name.trim()) return [];
    return [{
      name: row.name.trim(),
      description: stringValue(row.description) ?? "",
      source: stringValue(row.source) ?? "command",
      ...(typeof row.location === "string" ? { location: row.location } : {}),
    }];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
