import type { AssistantProvider, RemoteThread } from "./bridge";

/** Replace one provider's session catalog while preserving sessions from other providers. */
export function replaceProviderThreads(current: RemoteThread[], incoming: RemoteThread[], provider: AssistantProvider): RemoteThread[] {
  const byKey = new Map(current.filter((thread) => thread.provider !== provider).map((thread) => [`${thread.provider}\u0000${thread.id}`, thread]));
  for (const thread of incoming) byKey.set(`${provider}\u0000${thread.id}`, { ...thread, provider });
  return [...byKey.values()].sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a));
}

/** Insert or update sessions from one provider without removing its other sessions. */
export function upsertProviderThreads(current: RemoteThread[], incoming: RemoteThread[], provider: AssistantProvider): RemoteThread[] {
  const byKey = new Map(current.map((thread) => [`${thread.provider}\u0000${thread.id}`, thread]));
  for (const thread of incoming) byKey.set(`${provider}\u0000${thread.id}`, { ...thread, provider });
  return [...byKey.values()].sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a));
}

export function threadUpdatedAt(thread: RemoteThread | undefined): number {
  if (!thread || thread.updatedAt === null) return 0;
  const parsed = timestampMillis(thread.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function timestampMillis(value: string | number | null): number {
  if (value === null) return Number.NaN;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return Number.NaN;
    return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  }
  const trimmed = value.trim();
  if (/^-?\d{9,13}(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  }
  return Date.parse(trimmed);
}
