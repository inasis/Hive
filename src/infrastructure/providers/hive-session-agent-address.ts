import type { NativeSession } from "../../application/dto/a2a-collaboration.js";

export type HiveSessionAddress = { target: string; threadId: string };

export function encodeHiveSessionAddress(address: HiveSessionAddress): string {
  return encodeAddress(address);
}

export function decodeHiveSessionAddress(sessionId: string): HiveSessionAddress | undefined {
  if (!sessionId.startsWith("hive-session:v1:")) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(sessionId.slice("hive-session:v1:".length), "base64url").toString("utf8"));
    if (!isRecord(value) || typeof value.target !== "string" || !value.target.trim() ||
        typeof value.threadId !== "string" || !value.threadId.trim()) return undefined;
    return { target: value.target, threadId: value.threadId };
  } catch {
    return undefined;
  }
}

export function encodeHiveSessionAddressKey(address: HiveSessionAddress): string {
  return encodeAddress(address);
}

export function decodeHiveSessionAddressForProvider(session: NativeSession, provider: string): HiveSessionAddress | undefined {
  if (session.provider !== provider || session.persistenceLevel !== 2 || session.runtimeManagedHistory ||
      !session.sessionId.startsWith("hive-session:v1:")) return undefined;
  return decodeHiveSessionAddress(session.sessionId);
}

function encodeAddress(address: HiveSessionAddress): string {
  return `hive-session:v1:${Buffer.from(JSON.stringify(address), "utf8").toString("base64url")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
