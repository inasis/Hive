import type { AssistantEvent } from "../../application/ports/events.js";
import type { SerializedBridgeEvent, SerializedThreadSettings } from "./daemon-events.js";

/** Serialize application assistant events to the established bridge method/params shape. */
export function serializeAssistantEvent(event: AssistantEvent): SerializedBridgeEvent {
  const context = {
    target: event.target,
    threadId: event.threadId,
    ...(event.provider ? { provider: event.provider } : {}),
  };
  switch (event.type) {
    case "threadCreated":
      return {
        ...context,
        method: "thread/created",
        params: { threadId: event.threadId, name: event.title, cwd: event.cwd, preview: event.preview, updatedAt: event.updatedAt },
      };
    case "threadRenamed":
      return { ...context, method: "thread/name/updated", params: { threadId: event.threadId, name: event.title } };
    case "threadDeleted":
      return { ...context, method: "thread/deleted", params: { threadId: event.threadId } };
    case "transcriptCleared":
      return { ...context, method: "thread/transcript/cleared", params: { threadId: event.threadId } };
    case "turnStarted":
      return { ...context, method: "turn/started", params: { threadId: event.threadId, turn: event.turnId ? { id: event.turnId } : {} } };
    case "turnCompleted":
      return {
        ...context,
        method: "turn/completed",
        params: { threadId: event.threadId, turn: {
          ...(event.turnId ? { id: event.turnId } : {}),
          ...(event.status ? { status: event.status } : {}),
          ...(event.error ? { error: { message: event.error } } : {}),
        } },
      };
    case "assistantDelta":
      return {
        ...context,
        method: "item/agentMessage/delta",
        params: { threadId: event.threadId, turnId: event.turnId, itemId: event.messageId, delta: event.text },
      };
    case "assistantMessageCompleted":
      return {
        ...context,
        method: "item/completed",
        params: { threadId: event.threadId, turnId: event.turnId, item: { id: event.messageId, type: "agentMessage", text: event.text } },
      };
    case "a2aCommunicationSummary":
      return {
        ...context,
        method: "hive/a2a/communication-summary",
        params: {
          threadId: event.threadId,
          summaryId: event.summaryId,
          communications: event.communications,
          ...(event.responseTurnId ? { responseTurnId: event.responseTurnId } : {}),
        },
      };
    case "threadSettingsUpdated":
      return {
        ...context,
        method: "thread/settings/updated",
        params: { threadId: event.threadId, threadSettings: serializeThreadSettings(event.settings) },
      };
    case "commandsUpdated":
      return { ...context, method: "thread/commands/updated", params: { threadId: event.threadId, commands: event.commands } };
    case "toolStarted":
      return { ...context, method: "item/started", params: { threadId: event.threadId, ...(event.turnId ? { turnId: event.turnId } : {}), item: serializeToolActivity(event.activity, false) } };
    case "toolCompleted":
      return { ...context, method: "item/completed", params: { threadId: event.threadId, ...(event.turnId ? { turnId: event.turnId } : {}), item: serializeToolActivity(event.activity, true) } };
    case "warning":
      return { ...context, method: "warning", params: { threadId: event.threadId, message: event.message } };
    case "approvalRequested": {
      const approval = event.approval;
      const toolCall = {
        ...(approval.command ? { title: approval.command } : {}),
        ...(approval.reason ? { kind: approval.reason } : {}),
      };
      if (approval.kind === "permission") {
        return {
          ...context,
          method: "session/request_permission",
          params: {
            sessionId: event.threadId,
            ...(Object.keys(toolCall).length ? { toolCall } : {}),
            ...(approval.cwd ? { cwd: approval.cwd } : {}),
            ...(approval.itemId ? { itemId: approval.itemId } : {}),
            ...(approval.options ? { options: approval.options.map((option) => ({ optionId: option.id, name: option.label, ...(option.kind ? { kind: option.kind } : {}) })) } : {}),
          },
          requestId: event.requestId,
        };
      }
      const params = {
        threadId: event.threadId,
        ...(approval.command ? { command: approval.command } : {}),
        ...(approval.cwd ? { cwd: approval.cwd } : {}),
        ...(approval.reason ? { reason: approval.reason } : {}),
        ...(approval.itemId ? { itemId: approval.itemId } : {}),
        ...(Object.keys(toolCall).length ? { toolCall } : {}),
      };
      if (approval.kind === "file") {
        return { ...context, method: "item/fileChange/requestApproval", params, requestId: event.requestId };
      }
      return { ...context, method: "item/commandExecution/requestApproval", params, requestId: event.requestId };
    }
  }
}

function serializeThreadSettings(settings: Extract<AssistantEvent, { type: "threadSettingsUpdated" }>['settings']): SerializedThreadSettings {
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.permissionProfile ? { activePermissionProfile: { id: settings.permissionProfile } } : {}),
    ...(settings.currentModeId ? { currentModeId: settings.currentModeId } : {}),
    ...(settings.supportedReasoningEfforts ? { supportedReasoningEfforts: settings.supportedReasoningEfforts } : {}),
  };
}

function serializeToolActivity(activity: Extract<AssistantEvent, { type: "toolStarted" | "toolCompleted" }>['activity'], completed: boolean) {
  switch (activity.kind) {
    case "commandExecution":
      return {
        ...(activity.id ? { id: activity.id } : {}),
        type: "commandExecution" as const,
        ...(activity.command ? { command: activity.command } : {}),
        ...(activity.status ? { status: activity.status } : {}),
        ...(completed && activity.output !== undefined ? { aggregatedOutput: activity.output } : {}),
      };
    case "fileChange":
      return {
        ...(activity.id ? { id: activity.id } : {}),
        type: "fileChange" as const,
        changes: activity.paths.map((path) => ({ path })),
        ...(activity.status ? { status: activity.status } : {}),
      };
    case "webSearch":
      return {
        ...(activity.id ? { id: activity.id } : {}),
        type: "webSearch" as const,
        action: { queries: activity.queries },
        ...(activity.output !== undefined ? { result: activity.output } : {}),
        ...(activity.status ? { status: activity.status } : {}),
      };
  }
}
