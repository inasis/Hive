import type { A2ATaskResultDto, A2ATaskSubmissionDto } from "../dto/a2a-collaboration.js";
import { runtimeFault } from "./a2a-runtime-errors.js";
import { isRecord } from "./a2a-runtime-values.js";
import { requireNonEmpty } from "./a2a-runtime-validation.js";

/** Validate an externally supplied task submission before routing policy runs. */
export function validateSubmission(input: A2ATaskSubmissionDto): void {
  if (!isRecord(input)) throw runtimeFault("INVALID_REQUEST", "", "Task request must be an object");
  requireNonEmpty(input.roomId, "roomId");
  requireNonEmpty(input.message, "message");
  if (input.targetAgent !== undefined) requireNonEmpty(input.targetAgent, "targetAgent");
  if (input.targetSessionName !== undefined) {
    requireNonEmpty(input.targetSessionName, "targetSessionName");
    if (input.targetSessionName.trim().length > 120) {
      throw runtimeFault("INVALID_REQUEST", "", "targetSessionName must be 120 characters or fewer");
    }
  }
  if (input.selector !== undefined) {
    if (!isRecord(input.selector)) throw runtimeFault("INVALID_REQUEST", "", "Agent selector must be an object");
    const allowed = new Set(["role", "capabilities", "workspace", "provider"]);
    if (Object.keys(input.selector).some((key) => !allowed.has(key))) throw runtimeFault("INVALID_REQUEST", "", "Agent selector contains an unsupported field");
    const optionalFields: Array<"role" | "workspace" | "provider"> = ["role", "workspace", "provider"];
    for (const field of optionalFields) {
      const value = input.selector[field];
      if (value !== undefined) requireNonEmpty(value, `selector.${field}`);
    }
    if (input.selector.capabilities !== undefined &&
        (!Array.isArray(input.selector.capabilities) || input.selector.capabilities.some((item) => typeof item !== "string" || !item.trim()))) {
      throw runtimeFault("INVALID_REQUEST", "", "selector.capabilities must be a list of non-empty strings");
    }
  }
  if (input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 0)) {
    throw runtimeFault("INVALID_REQUEST", "", "timeoutMs must be a non-negative integer");
  }
  if (input.maxDepth !== undefined && (!Number.isSafeInteger(input.maxDepth) || input.maxDepth < 0)) {
    throw runtimeFault("INVALID_REQUEST", "", "maxDepth must be a non-negative integer");
  }
  if (input.metadata !== undefined && !isRecord(input.metadata)) throw runtimeFault("INVALID_REQUEST", "", "metadata must be an object");
}

/** Validate an adapter result and bind it to the task invocation that produced it. */
export function parseAgentResult(value: unknown, taskId: string, agentId: string): A2ATaskResultDto {
  if (!isAgentResult(value) || value.taskId !== taskId || value.agentId !== agentId) {
    throw runtimeFault("OUTPUT_PARSE_FAILED", "", "Adapter returned an invalid A2A result");
  }
  return value;
}

function isAgentResult(value: unknown): value is A2ATaskResultDto {
  if (!isRecord(value) || typeof value.taskId !== "string" || typeof value.agentId !== "string" ||
      typeof value.message !== "string" ||
      (value.status !== "COMPLETED" && value.status !== "FAILED" && value.status !== "CANCELLED" && value.status !== "TIMED_OUT")) return false;
  if (value.artifacts !== undefined && (!Array.isArray(value.artifacts) || value.artifacts.some((item) =>
    !isRecord(item) || typeof item.name !== "string" ||
    (item.uri !== undefined && typeof item.uri !== "string") ||
    (item.description !== undefined && typeof item.description !== "string")))) return false;
  return value.metadata === undefined || isRecord(value.metadata);
}
