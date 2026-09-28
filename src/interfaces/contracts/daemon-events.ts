import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { isAssistantProvider } from "../../domain/provider-catalog.js";
import type { AssistantCommand } from "../../domain/assistant.js";

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
