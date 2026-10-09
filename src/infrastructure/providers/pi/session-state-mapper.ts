import { readPiModel } from "./model-catalog.js";
import type { JsonObject, PiModel } from "./session-types.js";

export type PiSessionState = {
  sessionId: string;
  sessionFile: unknown;
  model?: PiModel;
  sessionName?: string;
  thinkingLevel?: string;
};

/** Converts Pi's get_state RPC record into provider-owned session fields. */
export function mapPiSessionState(
  value: JsonObject,
  sessionIdDescription = "Pi session ID",
): PiSessionState {
  const model = readPiModel(value.model);
  const sessionName = optionalString(value.sessionName);
  const thinkingLevel = optionalString(value.thinkingLevel);
  return {
    sessionId: requiredString(value.sessionId, sessionIdDescription),
    sessionFile: value.sessionFile,
    ...(model ? { model } : {}),
    ...(sessionName ? { sessionName } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}

/** Pi returns sessionFile as optional when a session is created. */
export function readOptionalPiSessionFile(value: unknown): string | undefined {
  return optionalString(value);
}

/** Existing sessions and forks must return their session file unchanged. */
export function requirePiSessionFile(value: unknown, description: string): string {
  return requiredString(value, description);
}

function requiredString(value: unknown, description: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Pi did not return a valid ${description}.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
