import type { AssistantEvent, AssistantEventPublisher, AssistantToolActivity } from "../../../application/ports/events.js";
import type { CodexRemoteSession } from "./session-context.js";
import { handleCodexServerRequest } from "./server-requests.js";

type JsonObject = Record<string, unknown>;

/** Translate Codex notifications and server requests into Hive events/responses. */
export function handleCodexNotification(
  publish: AssistantEventPublisher,
  target: string,
  session: CodexRemoteSession,
  method: string,
  params: unknown,
  requestId?: number | string,
): void {
  if (requestId !== undefined) {
    handleCodexServerRequest(publish, target, session, eventThreadId(params) ?? session.activeThreadId, method, params, requestId);
    return;
  }
  const eventParams = asObject(params);
  if (!eventParams) return;
  const threadId = eventThreadId(eventParams) ?? session.activeThreadId;
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

function mapCodexEvent(target: string, threadId: string, method: string, params: JsonObject): AssistantEvent | undefined {
  const context = { target, threadId, provider: "codex" as const };
  if (method === "thread/name/updated" && firstString(params.name)) {
    return { ...context, type: "threadRenamed", title: firstString(params.name)! };
  }
  if (method === "thread/deleted") return { ...context, type: "threadDeleted" };
  if (method === "thread/transcript/cleared") return { ...context, type: "transcriptCleared" };
  if (method === "turn/started") {
    const turnId = firstString(asObject(params.turn)?.id);
    return { ...context, type: "turnStarted", ...(turnId ? { turnId } : {}) };
  }
  if (method === "turn/completed") {
    const turn = asObject(params.turn);
    const error = firstString(asObject(turn?.error)?.message);
    return {
      ...context,
      type: "turnCompleted",
      ...(firstString(turn?.id) ? { turnId: firstString(turn?.id)! } : {}),
      ...(firstString(turn?.status) ? { status: firstString(turn?.status)! } : {}),
      ...(error ? { error } : {}),
    };
  }
  if (method === "item/agentMessage/delta") {
    if (typeof params.delta !== "string") return undefined;
    return {
      ...context,
      type: "assistantDelta",
      turnId: firstString(params.turnId) ?? "turn",
      messageId: firstString(params.itemId) ?? "assistant",
      text: params.delta,
    };
  }
  if (method === "thread/settings/updated") {
    const settings = asObject(params.threadSettings) ?? {};
    const reasoning = Array.isArray(settings.supportedReasoningEfforts)
      ? settings.supportedReasoningEfforts.flatMap((value) => {
          const option = asObject(value);
          return typeof option?.reasoningEffort === "string" && typeof option.description === "string"
            ? [{ reasoningEffort: option.reasoningEffort, description: option.description }]
            : [];
        })
      : undefined;
    return {
      ...context,
      type: "threadSettingsUpdated",
      settings: {
        ...(firstString(settings.model) ? { model: firstString(settings.model)! } : {}),
        ...(firstString(settings.effort) ? { effort: firstString(settings.effort)! } : {}),
        ...(firstString(asObject(settings.activePermissionProfile)?.id) ? { permissionProfile: firstString(asObject(settings.activePermissionProfile)?.id)! } : {}),
        ...(firstString(settings.currentModeId) ? { currentModeId: firstString(settings.currentModeId)! } : {}),
        ...(reasoning ? { supportedReasoningEfforts: reasoning } : {}),
      },
    };
  }
  if (method === "thread/commands/updated" && Array.isArray(params.commands)) {
    return {
      ...context,
      type: "commandsUpdated",
      commands: params.commands.flatMap((value) => {
        const command = asObject(value);
        if (typeof command?.name !== "string") return [];
        return [{
          name: command.name,
          description: firstString(command.description) ?? "",
          provider: firstString(command.provider) ?? "Codex",
          takesArguments: command.takesArguments === true,
        }];
      }),
    };
  }
  if (method === "item/started" || method === "item/completed") {
    const item = asObject(params.item);
    if (!item) return undefined;
    if (item.type === "agentMessage" && method === "item/completed") {
      const text = firstString(item.text) ?? contentText(item.content);
      if (!text) return undefined;
      return {
        ...context,
        type: "assistantMessageCompleted",
        turnId: firstString(params.turnId) ?? "turn",
        messageId: firstString(item.id) ?? "assistant",
        text,
      };
    }
    const activity = codexToolActivity(item);
    if (activity) return {
      ...context,
      type: method === "item/started" ? "toolStarted" : "toolCompleted",
      ...(firstString(params.turnId) ? { turnId: firstString(params.turnId)! } : {}),
      activity,
    };
  }
  if (method === "warning" && typeof params.message === "string") {
    return { ...context, type: "warning", message: params.message };
  }
  return undefined;
}

function codexToolActivity(item: JsonObject): AssistantToolActivity | undefined {
  const id = firstString(item.id);
  const status = firstString(item.status);
  if (item.type === "commandExecution") return {
    kind: "commandExecution",
    ...(id ? { id } : {}),
    command: displayValue(item.command),
    ...(firstString(item.aggregatedOutput, item.output) ? { output: firstString(item.aggregatedOutput, item.output)! } : {}),
    ...(status ? { status } : {}),
  };
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return {
      kind: "fileChange",
      ...(id ? { id } : {}),
      paths: changes.flatMap((change) => firstString(asObject(change)?.path) ? [firstString(asObject(change)?.path)!] : []),
      ...(status ? { status } : {}),
    };
  }
  if (item.type === "webSearch") {
    const action = asObject(item.action);
    const queries = Array.isArray(action?.queries)
      ? action.queries.flatMap((query) => typeof query === "string" && query.trim() ? [query.trim()] : [])
      : [];
    return {
      kind: "webSearch",
      ...(id ? { id } : {}),
      queries: queries.length ? queries : [firstString(action?.query, item.query) ?? ""],
      ...(firstString(item.result, item.content) ? { output: firstString(item.result, item.content)! } : {}),
      ...(status ? { status } : {}),
    };
  }
  return undefined;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => typeof part === "string" ? part : firstString(asObject(part)?.text) ?? "").filter(Boolean).join("\n");
}

function displayValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) return value.map((part) => String(part)).join(" ");
  return "(unavailable)";
}

function eventThreadId(params: unknown): string | undefined {
  return firstString(asObject(params)?.threadId, asObject(params)?.thread_id);
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
