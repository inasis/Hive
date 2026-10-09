export type CodexThread = {
  id: string;
  cwd?: string;
  title?: string;
  name?: string;
  preview?: string;
  updatedAt?: string | number;
};

type JsonObject = Record<string, unknown>;

export function parseCodexThread(value: unknown): CodexThread | undefined {
  const thread = asObject(value);
  const id = firstString(thread?.id);
  if (!thread || !id) return undefined;
  const updatedAt = typeof thread.updatedAt === "string" || typeof thread.updatedAt === "number" ? thread.updatedAt : undefined;
  return {
    id,
    ...(typeof thread.cwd === "string" ? { cwd: thread.cwd } : {}),
    ...(typeof thread.title === "string" ? { title: thread.title } : {}),
    ...(typeof thread.name === "string" ? { name: thread.name } : {}),
    ...(typeof thread.preview === "string" ? { preview: thread.preview } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
