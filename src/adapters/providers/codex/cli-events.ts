import type { CodexCliEvent } from "../../../application/ports/codex-cli.js";

/** Translate app-server notifications into the typed events used by the interactive CLI. */
export function mapCodexCliNotification(
  target: string,
  fallbackThreadId: string | undefined,
  method: string,
  value: unknown,
  requestId?: number | string,
): CodexCliEvent | undefined {
  const params = asObject(value);
  const threadId = firstString(params?.threadId, params?.thread_id, fallbackThreadId);
  if (!threadId) return undefined;

  if (requestId !== undefined && method === "item/commandExecution/requestApproval") {
    return {
      target,
      threadId,
      type: "commandApproval",
      requestId,
      command: displayValue(params?.command),
      ...(firstString(params?.cwd) ? { cwd: firstString(params?.cwd)! } : {}),
      ...(firstString(params?.reason) ? { reason: firstString(params?.reason)! } : {}),
      ...(firstString(params?.itemId) ? { itemId: firstString(params?.itemId)! } : {}),
    };
  }
  if (requestId !== undefined && method === "item/fileChange/requestApproval") {
    return {
      target,
      threadId,
      type: "fileApproval",
      requestId,
      ...(firstString(params?.reason) ? { reason: firstString(params?.reason)! } : {}),
      ...(firstString(params?.itemId) ? { itemId: firstString(params?.itemId)! } : {}),
    };
  }

  if (method === "item/started") {
    const item = asObject(params?.item);
    if (item?.type === "commandExecution") return { target, threadId, type: "commandStarted", command: displayValue(item.command) };
    if (item?.type === "fileChange") return { target, threadId, type: "fileChangesStarted" };
  }
  if (method === "item/agentMessage/delta" && typeof params?.delta === "string" && params.delta.length > 0) {
    return { target, threadId, type: "assistantDelta", text: params.delta };
  }
  if (method === "turn/completed") {
    const turn = asObject(params?.turn);
    const failure = asObject(turn?.error);
    return {
      target,
      threadId,
      type: "turnCompleted",
      status: firstString(turn?.status) ?? "unknown",
      ...(firstString(failure?.message) ? { error: firstString(failure?.message)! } : {}),
    };
  }
  if (method === "warning" && typeof params?.message === "string") {
    return { target, threadId, type: "warning", message: params.message };
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function displayValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && value.length > 0) return value.map((part) => String(part)).join(" ");
  return "(unavailable)";
}
