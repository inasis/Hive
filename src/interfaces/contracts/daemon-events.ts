import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { isAssistantProvider } from "../../domain/provider-catalog.js";
import type { AssistantCommand } from "../../domain/assistant.js";
import type { TerminalEvent } from "../../application/ports/terminal.js";
import type { AssistantEvent } from "../../application/ports/events.js";

/** Existing daemon and desktop bridge event wire shape. */
export type BridgeEvent = {
  target: string;
  threadId: string;
  method: string;
  params: Record<string, unknown>;
  provider?: AssistantProvider;
  requestId?: number | string;
};

type BridgeEventContext = Pick<BridgeEvent, "target" | "threadId" | "provider">;
type BridgeEventFor<Method extends string, Params extends Record<string, unknown>, Request extends boolean = false> =
  BridgeEventContext & { method: Method; params: Params } & (Request extends true ? { requestId: number | string } : { requestId?: number | string });

type SerializedToolActivity =
  | { id?: string; type: "commandExecution"; command?: string; status?: string; aggregatedOutput?: string }
  | { id?: string; type: "fileChange"; changes: Array<{ path: string }>; status?: string }
  | { id?: string; type: "webSearch"; action: { queries: string[] }; result?: string; status?: string };

/** Typed output variants produced by the application and terminal event serializers. */
export type SerializedBridgeEvent =
  | BridgeEventFor<"thread/name/updated", { threadId: string; name: string }>
  | BridgeEventFor<"thread/deleted" | "thread/transcript/cleared", { threadId: string }>
  | BridgeEventFor<"turn/started", { threadId: string; turn: { id?: string } }>
  | BridgeEventFor<"turn/completed", { threadId: string; turn: { id?: string; status?: string; error?: { message: string } } }>
  | BridgeEventFor<"item/agentMessage/delta", { threadId: string; turnId: string; itemId: string; delta: string }>
  | BridgeEventFor<"item/completed", { threadId: string; turnId: string; item: { id: string; type: "agentMessage"; text: string } | SerializedToolActivity }>
  | BridgeEventFor<"thread/settings/updated", { threadId: string; threadSettings: Record<string, unknown> }>
  | BridgeEventFor<"thread/commands/updated", { threadId: string; commands: AssistantCommand[] }>
  | BridgeEventFor<"item/started", { threadId: string; turnId?: string; item: SerializedToolActivity }>
  | BridgeEventFor<"item/completed", { threadId: string; turnId?: string; item: SerializedToolActivity }>
  | BridgeEventFor<"warning", { threadId: string; message: string }>
  | BridgeEventFor<"item/commandExecution/requestApproval", { threadId: string; command?: string; cwd?: string; reason?: string; itemId?: string; toolCall?: { title?: string; kind?: string } }, true>
  | BridgeEventFor<"item/fileChange/requestApproval", { threadId: string; command?: string; cwd?: string; reason?: string; itemId?: string; toolCall?: { title?: string; kind?: string } }, true>
  | BridgeEventFor<"session/request_permission", { sessionId: string; toolCall?: { title?: string; kind?: string }; cwd?: string; itemId?: string; options?: Array<{ optionId: string; name: string; kind?: string }> }, true>
  | BridgeEventFor<"terminal/data", { data: string }>
  | BridgeEventFor<"terminal/ready", { cwd: string }>
  | BridgeEventFor<"terminal/error", { message: string }>
  | BridgeEventFor<"terminal/exit", { exitCode: number | null; signal: number | null }>;

/** Serialize the typed terminal port event to the established bridge wire contract. */
export function serializeTerminalEvent(event: TerminalEvent): SerializedBridgeEvent {
  switch (event.type) {
    case "data":
      return { target: event.target, threadId: event.sessionId, method: "terminal/data", params: { data: event.data } };
    case "ready":
      return { target: event.target, threadId: event.sessionId, method: "terminal/ready", params: { cwd: event.cwd } };
    case "error":
      return { target: event.target, threadId: event.sessionId, method: "terminal/error", params: { message: event.message } };
    case "exit":
      return {
        target: event.target,
        threadId: event.sessionId,
        method: "terminal/exit",
        params: { exitCode: event.exitCode, signal: event.signal },
      };
  }
}

/** Serialize application events to the established daemon and desktop bridge event format. */
export function serializeAssistantEvent(event: AssistantEvent): SerializedBridgeEvent {
  const context = {
    target: event.target,
    threadId: event.threadId,
    ...(event.provider ? { provider: event.provider } : {}),
  };
  switch (event.type) {
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

function serializeThreadSettings(settings: Extract<AssistantEvent, { type: "threadSettingsUpdated" }>['settings']): Record<string, unknown> {
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.permissionProfile ? { activePermissionProfile: { id: settings.permissionProfile } } : {}),
    ...(settings.currentModeId ? { currentModeId: settings.currentModeId } : {}),
    ...(settings.supportedReasoningEfforts ? { supportedReasoningEfforts: settings.supportedReasoningEfforts } : {}),
  };
}

function serializeToolActivity(activity: Extract<AssistantEvent, { type: "toolStarted" | "toolCompleted" }>['activity'], completed: boolean): SerializedToolActivity {
  switch (activity.kind) {
    case "commandExecution":
      return {
        ...(activity.id ? { id: activity.id } : {}),
        type: "commandExecution",
        ...(activity.command ? { command: activity.command } : {}),
        ...(activity.status ? { status: activity.status } : {}),
        ...(completed && activity.output !== undefined ? { aggregatedOutput: activity.output } : {}),
      };
    case "fileChange":
      return {
        ...(activity.id ? { id: activity.id } : {}),
        type: "fileChange",
        changes: activity.paths.map((path) => ({ path })),
        ...(activity.status ? { status: activity.status } : {}),
      };
    case "webSearch":
      return {
        ...(activity.id ? { id: activity.id } : {}),
        type: "webSearch",
        action: { queries: activity.queries },
        ...(activity.output !== undefined ? { result: activity.output } : {}),
        ...(activity.status ? { status: activity.status } : {}),
      };
  }
}

/** Parse event packets received from the daemon WebSocket before exposing them to UI listeners. */
export function parseBridgeEvent(value: unknown): BridgeEvent | undefined {
  const event = asRecord(value);
  if (!event || typeof event.target !== "string" || typeof event.threadId !== "string" ||
      typeof event.method !== "string") return undefined;
  const params = event.params === undefined ? {} : asRecord(event.params);
  if (!params) return undefined;
  if (event.provider !== undefined && !isAssistantProvider(event.provider)) return undefined;
  if (event.requestId !== undefined && !((typeof event.requestId === "string" && event.requestId.length > 0) ||
      (typeof event.requestId === "number" && Number.isFinite(event.requestId)))) return undefined;
  return {
    target: event.target,
    threadId: event.threadId,
    method: event.method,
    params,
    ...(event.provider !== undefined ? { provider: event.provider } : {}),
    ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
