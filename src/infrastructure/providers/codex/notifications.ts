import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { CodexRemoteSession } from "./session-context.js";
import { codexNotificationThreadId, mapCodexEvent } from "./event-mapper.js";
import { handleCodexServerRequest } from "./server-requests.js";

type JsonObject = Record<string, unknown>;

/** Coordinate Codex notifications, session cache updates, and server requests. */
export function handleCodexNotification(
  publish: AssistantEventPublisher,
  target: string,
  session: CodexRemoteSession,
  method: string,
  params: unknown,
  requestId?: number | string,
): void {
  if (requestId !== undefined) {
    handleCodexServerRequest(publish, target, session, codexNotificationThreadId(params) ?? session.activeThreadId, method, params, requestId);
    return;
  }
  const eventParams = asObject(params);
  if (!eventParams) return;
  const threadId = codexNotificationThreadId(eventParams) ?? session.activeThreadId;
  if (!threadId) return;
  // A newly created thread needs full history as soon as its first turn starts,
  // including when the UI reopens it while the response is still running.
  if (method === "turn/started" || method === "turn/completed" || method === "thread/deleted") {
    session.freshThreadIds.delete(threadId);
  }
  if (method === "thread/settings/updated") {
    const settings = asObject(eventParams.threadSettings);
    const permissionProfile = firstString(asObject(settings?.activePermissionProfile)?.id);
    const collaborationMode = firstString(asObject(settings?.collaborationMode)?.mode);
    const current = session.settingsByThread.get(threadId);
    if (current && (permissionProfile || collaborationMode === "default" || collaborationMode === "plan")) {
      session.settingsByThread.set(threadId, {
        ...current,
        ...(permissionProfile ? { permissionProfile } : {}),
        ...(collaborationMode === "default" || collaborationMode === "plan" ? { collaborationMode } : {}),
      });
    }
  }
  const event = mapCodexEvent(target, threadId, method, eventParams);
  if (event) publish(event);
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
