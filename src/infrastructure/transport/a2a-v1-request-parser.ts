import type { A2AAgentSelectorDto, A2ATaskSubmissionDto } from "../../application/dto/a2a-collaboration.js";
import { httpError, isRecord } from "./a2a-http-common.js";

/** Parse the untrusted task body into the typed A2A request consumed by Application. */
export function parseA2ATaskSubmission(value: unknown): A2ATaskSubmissionDto {
  if (!isA2ATaskSubmission(value)) {
    throw httpError(400, "INVALID_REQUEST", "Task submission fields are invalid.");
  }
  return value;
}

/** Parse only supported profile fields; unknown top-level fields remain ignored for compatibility. */
export function parseA2AAgentProfileUpdate(value: unknown): { role?: string | null; capabilities?: string[] } {
  if (!isRecord(value)) throw httpError(400, "INVALID_REQUEST", "Agent profile update must be an object.");

  const update: { role?: string | null; capabilities?: string[] } = {};
  if (value.role !== undefined) {
    if (value.role !== null && typeof value.role !== "string") {
      throw httpError(400, "INVALID_REQUEST", "role must be a string or null.");
    }
    update.role = value.role;
  }
  if (value.capabilities !== undefined) {
    if (!isStringArray(value.capabilities)) {
      throw httpError(400, "INVALID_REQUEST", "capabilities must be an array of strings.");
    }
    update.capabilities = value.capabilities;
  }
  if (Object.keys(update).length === 0) {
    throw httpError(400, "INVALID_REQUEST", "Provide role or capabilities to update.");
  }
  return update;
}

function isA2ATaskSubmission(value: unknown): value is A2ATaskSubmissionDto {
  return isRecord(value) && typeof value.roomId === "string" && typeof value.message === "string" &&
    optionalString(value, "targetAgent") && optionalString(value, "targetSessionName") &&
    optionalNumber(value, "timeoutMs") && optionalNumber(value, "maxDepth") &&
    (value.selector === undefined || isAgentSelector(value.selector)) &&
    (value.metadata === undefined || isRecord(value.metadata));
}

function isAgentSelector(value: unknown): value is A2AAgentSelectorDto {
  if (!isRecord(value) || !optionalString(value, "role") || !optionalString(value, "workspace") ||
      !optionalString(value, "provider")) return false;
  return value.capabilities === undefined || isStringArray(value.capabilities);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function optionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

function optionalNumber(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "number";
}
