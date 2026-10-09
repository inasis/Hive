import type { AssistantToolActivity } from "../../../application/ports/events.js";
import { asObject } from "./session-json-values.js";
import { messageText } from "./session-transcript.js";
import { mapPiToolActivity } from "./session-tool-activity-mapper.js";
import type { JsonObject } from "./session-types.js";

export type PiTurnEvent =
  | { type: "assistantMessageStarted" }
  | { type: "assistantTextDelta"; text: string }
  | { type: "assistantMessageEnded"; text: string }
  | { type: "toolStarted"; activity: AssistantToolActivity }
  | { type: "toolCompleted"; activity: AssistantToolActivity }
  | { type: "agentError"; message: string }
  | { type: "agentSettled" };

/** Converts Pi RPC records into turn events without carrying Pi payload shapes into turn orchestration. */
export function mapPiTurnEvent(record: JsonObject): PiTurnEvent | undefined {
  if (record.type === "message_start") {
    const message = asObject(record.message);
    return message?.role === "assistant" ? { type: "assistantMessageStarted" } : undefined;
  }
  if (record.type === "message_update") {
    const update = asObject(record.assistantMessageEvent);
    return update?.type === "text_delta" && typeof update.delta === "string"
      ? { type: "assistantTextDelta", text: update.delta }
      : undefined;
  }
  if (record.type === "message_end") {
    const message = asObject(record.message);
    return message?.role === "assistant"
      ? { type: "assistantMessageEnded", text: messageText(message.content) }
      : undefined;
  }
  if (record.type === "tool_execution_start") {
    return { type: "toolStarted", activity: mapPiToolActivity(record) };
  }
  if (record.type === "tool_execution_end") {
    return { type: "toolCompleted", activity: mapPiToolActivity(record, true) };
  }
  if (record.type === "agent_end" && record.willRetry !== true) {
    const messages = Array.isArray(record.messages) ? record.messages : [];
    const last = asObject(messages.at(-1));
    if (last?.stopReason === "error") {
      return {
        type: "agentError",
        message: optionalString(last.errorMessage) ?? "Pi could not complete the model request.",
      };
    }
  }
  if (record.type === "agent_settled") return { type: "agentSettled" };
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
