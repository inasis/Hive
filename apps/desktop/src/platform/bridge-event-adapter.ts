import type { ReasoningEffortDto } from "../../../../src/application/dto/assistant.js";
import type { BridgeEvent } from "../../../../src/presentation/shared/bridge";
import type { ApprovalUiDetails, UiBridgeEvent, UiCommand } from "../../../../src/presentation/shared/bridge-events";
import { mapA2ACommunicationSummaryEvent } from "./a2a-communication-summary-event.js";
import { asRecord, displayValue, stringValue } from "./bridge-event-values.js";
import { mapTranscriptItemCompleted, mapTranscriptItemStarted } from "./bridge-transcript-adapter.js";

/** Convert the established bridge event envelope into presentation events without changing its wire shape. */
export function normalizeBridgeEvent(event: BridgeEvent): UiBridgeEvent[] {
  const params = event.params;
  const context = { target: event.target, threadId: event.threadId, ...(event.provider ? { provider: event.provider } : {}) };

  if (event.requestId !== undefined) {
    return [{
      ...context,
      type: "approvalRequested",
      requestId: event.requestId,
      approval: approvalDetails(event.method, params),
    }];
  }

  switch (event.method) {
    case "thread/created": {
      const title = stringValue(params.name)?.trim();
      const cwd = stringValue(params.cwd)?.trim();
      if (!title || !cwd) return [];
      const updatedAt = typeof params.updatedAt === "string" || typeof params.updatedAt === "number" ? params.updatedAt : null;
      const hiveSessionId = stringValue(params.hiveSessionId);
      return [{
        ...context,
        type: "threadCreated",
        title,
        cwd,
        preview: stringValue(params.preview) ?? "",
        updatedAt,
        ...(hiveSessionId ? { hiveSessionId } : {}),
      }];
    }
    case "thread/name/updated": {
      const title = stringValue(params.name)?.trim();
      return title ? [{ ...context, type: "threadRenamed", title }] : [];
    }
    case "thread/deleted": {
      const threadId = event.threadId || stringValue(params.threadId) || stringValue(params.thread_id);
      return threadId ? [{ ...context, threadId, type: "threadDeleted" }] : [];
    }
    case "thread/transcript/cleared":
      return [{ ...context, type: "transcriptCleared" }];
    case "turn/started":
      return [{ ...context, type: "turnStarted", ...(nestedString(params.turn, "id") ? { turnId: nestedString(params.turn, "id") } : {}) }];
    case "turn/completed": {
      const turn = asRecord(params.turn);
      const error = stringValue(asRecord(turn?.error)?.message);
      return [{
        ...context,
        type: "turnCompleted",
        ...(stringValue(turn?.id) ? { turnId: stringValue(turn?.id) } : {}),
        ...(error ? { error } : {}),
      }];
    }
    case "item/agentMessage/delta": {
      const rawTurnId = stringValue(params.turnId);
      const turnId = rawTurnId ?? "turn";
      const text = typeof params.delta === "string" ? params.delta : "";
      const messageId = stringValue(params.itemId) ?? "assistant";
      return [
        { ...context, type: "turnStarted", ...(rawTurnId ? { turnId: rawTurnId } : {}) },
        ...(text ? [{ ...context, type: "assistantDelta" as const, turnId, messageId, text }] : []),
      ];
    }
    case "hive/a2a/communication-summary": {
      const update = mapA2ACommunicationSummaryEvent(params);
      return update ? [{ ...context, ...update }] : [];
    }
    case "thread/settings/updated":
      return [{ ...context, type: "threadSettingsUpdated", settings: threadSettings(params.threadSettings) }];
    case "thread/commands/updated":
      return [{ ...context, type: "commandsUpdated", commands: commands(params.commands) }];
    case "item/started": {
      const update = mapTranscriptItemStarted(params.item);
      return update ? [{ ...context, ...update }] : [];
    }
    case "item/completed": {
      const update = mapTranscriptItemCompleted(params.item, params);
      return update ? [{ ...context, ...update }] : [];
    }
    case "warning": {
      const message = stringValue(params.message);
      return message ? [{ ...context, type: "warning", message }] : [];
    }
    case "terminal/ready":
      return [{ ...context, type: "terminalReady" }];
    case "terminal/data":
      return typeof params.data === "string" ? [{ ...context, type: "terminalData", data: params.data }] : [];
    case "terminal/error":
      return [{ ...context, type: "terminalError", message: stringValue(params.message) ?? "터미널 연결 오류" }];
    case "terminal/exit":
      return [{ ...context, type: "terminalExit", exitCode: typeof params.exitCode === "number" ? params.exitCode : null }];
    case "hive/transport/disconnected":
      return [{ ...context, type: "transportDisconnected", ...(stringValue(params.message) ? { message: stringValue(params.message) } : {}) }];
    case "hive/transport/failed":
      return [{ ...context, type: "transportFailed", ...(stringValue(params.message) ? { message: stringValue(params.message) } : {}) }];
    case "hive/transport/keepalive-failed":
      return [{ ...context, type: "transportKeepAliveFailed", ...(stringValue(params.message) ? { message: stringValue(params.message) } : {}) }];
    case "hive/transport/reconnected":
      return [{ ...context, type: "transportReconnected" }];
    default:
      return [];
  }
}

function approvalDetails(method: string, params: Record<string, unknown>): ApprovalUiDetails {
  const toolCall = asRecord(params.toolCall);
  const kind = method.includes("commandExecution") ? "command" :
    method.includes("fileChange") ? "file" : method.includes("permission") ? "permission" : "other";
  const command = displayValue(params.command ?? toolCall?.title);
  const reason = stringValue(params.reason ?? toolCall?.kind);
  return {
    kind,
    ...(reason ? { reason } : {}),
    ...(command ? { command } : {}),
    ...(stringValue(params.cwd) ? { cwd: stringValue(params.cwd) } : {}),
    ...(stringValue(params.itemId) ? { itemId: stringValue(params.itemId) } : {}),
  };
}

function threadSettings(value: unknown): Extract<UiBridgeEvent, { type: "threadSettingsUpdated" }>['settings'] {
  const settings = asRecord(value) ?? {};
  const reasoning = Array.isArray(settings.supportedReasoningEfforts)
    ? settings.supportedReasoningEfforts.flatMap((value): ReasoningEffortDto[] => {
        const option = asRecord(value);
        return typeof option?.reasoningEffort === "string" && typeof option.description === "string"
          ? [{ reasoningEffort: option.reasoningEffort, description: option.description }]
          : [];
      })
    : undefined;
  return {
    ...(stringValue(settings.model) ? { model: stringValue(settings.model) } : {}),
    effort: stringValue(settings.effort) ?? null,
    permissionProfile: stringValue(settings.permissionProfile) ?? stringValue(asRecord(settings.activePermissionProfile)?.id) ?? null,
    modeId: stringValue(settings.currentModeId) ?? null,
    ...(reasoning ? { supportedReasoningEfforts: reasoning } : {}),
  };
}

function commands(value: unknown): UiCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value): UiCommand[] => {
    const command = asRecord(value);
    return typeof command?.name === "string"
      ? [{
          name: command.name,
          description: stringValue(command.description) ?? "",
          ...(stringValue(command.provider) ? { provider: stringValue(command.provider) } : {}),
          takesArguments: command.takesArguments === true,
        }]
      : [];
  });
}

function nestedString(value: unknown, key: string): string | undefined {
  return stringValue(asRecord(value)?.[key]);
}
