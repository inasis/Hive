import type { AssistantEvent } from "../../../application/ports/events.js";
import { mapCodexToolActivity } from "./tool-activity-mapper.js";

type JsonObject = Record<string, unknown>;

/** Map Codex notification payloads into Hive assistant events. */
export function mapCodexEvent(target: string, threadId: string, method: string, params: JsonObject): AssistantEvent | undefined {
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
    const activity = mapCodexToolActivity(item);
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

export function codexNotificationThreadId(params: unknown): string | undefined {
  return firstString(asObject(params)?.threadId, asObject(params)?.thread_id);
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => typeof part === "string" ? part : firstString(asObject(part)?.text) ?? "").filter(Boolean).join("\n");
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
