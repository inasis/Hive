import type { A2AAgentSessionToolRequestDto as AgentSessionToolRequest } from "../../application/dto/a2a-collaboration.js";
import type { A2AAgentSelectorDto as AgentSelector } from "../../application/dto/a2a-collaboration.js";
import { isRecord } from "./a2a-http-common.js";

type A2AMcpSendToolName = "a2a_send" | "a2a_reply" | "a2b_send";

/** Validates MCP send-tool arguments and maps them to the application runtime request. */
export function parseA2AMcpToolRequest(
  name: A2AMcpSendToolName,
  input: Record<string, unknown>,
): AgentSessionToolRequest {
  const message = parseRequiredA2AMcpToolString(input.message, "message");
  const targetAgent = parseOptionalA2AMcpToolString(input.targetAgent, "targetAgent");
  const targetSessionName = parseOptionalA2AMcpToolString(input.targetSessionName, "targetSessionName");
  const selector = parseToolSelector(input.selector);
  const replyToTaskId = parseOptionalA2AMcpToolString(input.replyToTaskId, "replyToTaskId");
  const hasExplicitTarget = Boolean(targetAgent || targetSessionName || selector);
  const isReply = name === "a2a_reply";
  if ((targetAgent || targetSessionName) && selector) {
    throw new Error("Provide one targetAgent/targetSessionName or one selector.");
  }
  if (isReply && (!replyToTaskId || hasExplicitTarget)) {
    throw new Error("a2a_reply requires replyToTaskId and does not accept a target.");
  }
  if (!hasExplicitTarget && !replyToTaskId) {
    throw new Error("Provide targetAgent or replyToTaskId.");
  }
  if (replyToTaskId && selector) {
    throw new Error("A reply can target one agent, not a selector.");
  }
  if (targetSessionName && targetSessionName.length > 120) throw new Error("targetSessionName must be 120 characters or fewer.");
  const timeoutMs = input.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 0)) {
    throw new Error("timeoutMs must be a non-negative integer.");
  }
  const legacyResponseForTaskId = parseOptionalA2AMcpToolString(input.responseForTaskId, "responseForTaskId");
  const legacyCallbackForTaskId = parseOptionalA2AMcpToolString(input.callbackForTaskId, "callbackForTaskId");
  if (isReply && (legacyResponseForTaskId || legacyCallbackForTaskId || targetSessionName || selector)) {
    throw new Error("a2a_reply does not accept a target or legacy correlation fields.");
  }
  if (replyToTaskId && (legacyResponseForTaskId || legacyCallbackForTaskId)) {
    throw new Error("Use replyToTaskId without responseForTaskId or callbackForTaskId.");
  }
  const responseForTaskId = legacyResponseForTaskId ??
    (!isReply && replyToTaskId && hasExplicitTarget ? replyToTaskId : undefined);
  const callbackForTaskId = legacyCallbackForTaskId ??
    (isReply ? replyToTaskId : replyToTaskId && !hasExplicitTarget ? replyToTaskId : undefined);
  if (name === "a2b_send" && (!targetAgent || targetSessionName !== undefined || selector !== undefined || responseForTaskId !== undefined || callbackForTaskId !== undefined)) {
    throw new Error("a2b_send requires one exact agentId or callerAgentId and does not accept selectors, session titles, or callbacks.");
  }
  return {
    interaction: name === "a2b_send" ? "A2B" : "A2A",
    ...(targetAgent ? { targetAgent } : {}),
    ...(targetSessionName ? { targetSessionName } : {}),
    ...(selector ? { selector } : {}),
    message,
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
    ...(responseForTaskId ? { responseForTaskId } : {}),
    ...(callbackForTaskId ? { callbackForTaskId } : {}),
  };
}

export function parseRequiredA2AMcpToolString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function parseOptionalA2AMcpToolString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return parseRequiredA2AMcpToolString(value, name);
}

function parseToolSelector(value: unknown): AgentSelector | undefined {
  if (value === undefined) return undefined;
  const selector = isRecord(value) ? value : undefined;
  if (!selector || Object.keys(selector).some((key) => !["role", "capabilities", "provider", "workspace"].includes(key))) {
    throw new Error("selector must contain only role, capabilities, provider, and workspace fields.");
  }
  const result: AgentSelector = {};
  for (const key of ["role", "provider", "workspace"] as const) {
    const candidate = selector[key];
    if (candidate !== undefined) result[key] = parseRequiredA2AMcpToolString(candidate, `selector.${key}`);
  }
  if (selector.capabilities !== undefined) {
    if (!Array.isArray(selector.capabilities) || selector.capabilities.length === 0) throw new Error("selector.capabilities must be a non-empty string array.");
    result.capabilities = selector.capabilities.map((value) => parseRequiredA2AMcpToolString(value, "selector.capabilities[]"));
  }
  if (!Object.keys(result).length) throw new Error("selector must include at least one constraint.");
  return result;
}
