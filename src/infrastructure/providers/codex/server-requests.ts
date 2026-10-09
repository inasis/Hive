import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { CodexRemoteSession } from "./session-context.js";

type JsonObject = Record<string, unknown>;

/** Resolve Codex app-server requests that Hive supports and reject the rest explicitly. */
export function handleCodexServerRequest(
  publish: AssistantEventPublisher,
  target: string,
  session: CodexRemoteSession,
  threadId: string | undefined,
  method: string,
  params: unknown,
  requestId: number | string,
): void {
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    const requestParams = asObject(params);
    if (!threadId || !requestParams) {
      session.api.respondToRequest(requestId, { decision: "decline" });
      return;
    }
    const toolCall = asObject(requestParams.toolCall);
    const isCommand = method === "item/commandExecution/requestApproval";
    const command = displayValue(requestParams.command ?? toolCall?.title);
    publish({
      target,
      threadId,
      provider: "codex",
      type: "approvalRequested",
      requestId,
      approval: {
        kind: isCommand ? "command" : "file",
        ...(command ? { command } : {}),
        ...(firstString(requestParams.cwd) ? { cwd: firstString(requestParams.cwd)! } : {}),
        ...(firstString(requestParams.reason, toolCall?.kind) ? { reason: firstString(requestParams.reason, toolCall?.kind)! } : {}),
        ...(firstString(requestParams.itemId) ? { itemId: firstString(requestParams.itemId)! } : {}),
      },
    });
    return;
  }
  if (method === "item/permissions/requestApproval") {
    session.api.respondToRequest(requestId, { permissions: [] });
    return;
  }
  if (method === "mcpServer/elicitation/request") {
    session.api.respondToRequest(requestId, { action: "decline", content: null });
    return;
  }
  session.api.respondWithError(requestId, -32601, `Hive does not support server request: ${method}`);
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) return value.map((part) => String(part)).join(" ");
  return undefined;
}
