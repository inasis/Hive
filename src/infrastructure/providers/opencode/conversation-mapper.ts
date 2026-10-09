import type { TranscriptEntry } from "../../../domain/assistant.js";
import { providerA2ASummaryEntryId, providerPromptTranscript } from "../a2a-prompt-context.js";
import type { OpenCodeMessage, OpenCodeSessionInfo } from "./conversation-protocol.js";

/** Extract visible text parts from a normalized OpenCode message. */
export function openCodeMessageText(message: OpenCodeMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.flatMap((partValue) => {
    const part = asObject(partValue);
    return part?.type === "text" && typeof part.text === "string" ? [part.text] : [];
  }).join("\n");
}

export function openCodeModelFromMessages(messages: OpenCodeMessage[]): string | undefined {
  const latest = [...messages].reverse().find((message) => message.info?.role === "assistant");
  const providerID = latest?.info?.providerID;
  const modelID = latest?.info?.modelID;
  return typeof providerID === "string" && typeof modelID === "string" ? `${providerID}/${modelID}` : undefined;
}

export function openCodeModelFromSession(session: OpenCodeSessionInfo): string | undefined {
  const model = asObject(session.model);
  const providerID = firstString(model?.providerID);
  const modelID = firstString(model?.id, model?.modelID);
  return providerID && modelID ? `${providerID}/${modelID}` : undefined;
}

export function mapOpenCodeSession(session: OpenCodeSessionInfo): {
  id: string;
  title: string;
  cwd: string;
  preview: string;
  updatedAt: number | null;
} {
  return {
    id: session.id,
    title: typeof session.title === "string" && session.title.trim() ? session.title : "새 세션",
    cwd: typeof session.directory === "string" ? session.directory : typeof session.location?.directory === "string" ? session.location.directory : "",
    preview: "",
    updatedAt: typeof session.time?.updated === "number" ? session.time.updated : null,
  };
}

export function mapOpenCodeTranscript(messages: OpenCodeMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let currentTurnId = "";
  for (const [messageIndex, message] of messages.entries()) {
    const messageId = typeof message.info?.id === "string" ? message.info.id : `message-${messageIndex}`;
    const createdAt = typeof message.info?.time?.created === "number" && Number.isFinite(message.info.time.created)
      ? message.info.time.created
      : undefined;
    if (message.info?.role === "user") currentTurnId = messageId;
    if (message.info?.role === "user" || message.info?.role === "assistant") {
      const rawText = openCodeMessageText(message);
      const turnId = message.info.role === "user" ? messageId : currentTurnId || messageId;
      const responseCompleted = message.info.role !== "assistant" ||
        (typeof message.info.time?.completed === "number" && message.info.time.completed > 0) || Boolean(message.info.finish);
      if (message.info.role === "user") {
        const prompt = providerPromptTranscript(rawText);
        const promptCreatedAt = earliestCommunicationCreatedAt(prompt.communications) ?? createdAt;
        if (prompt.text) entries.push({ id: messageId, turnId, providerMessageId: messageId, role: "user", text: prompt.text, responseCompleted, ...(createdAt !== undefined ? { createdAt } : {}) });
        if (prompt.communications.length) entries.push({
          id: providerA2ASummaryEntryId(prompt.communications),
          role: "communication",
          text: "",
          turnId,
          ...(promptCreatedAt !== undefined ? { createdAt: promptCreatedAt } : {}),
          communications: prompt.communications,
        });
      } else if (rawText) {
        entries.push({ id: messageId, turnId, providerMessageId: messageId, role: "assistant", text: rawText, responseCompleted, ...(createdAt !== undefined ? { createdAt } : {}) });
      }
    }
    for (const [partIndex, partValue] of (Array.isArray(message.parts) ? message.parts : []).entries()) {
      const part = asObject(partValue);
      if (!part || part.type === "text" || part.type === "step-start" || part.type === "step-finish" || part.type === "reasoning") continue;
      if (part.type === "tool") {
        const state = asObject(part.state);
        const input = asObject(state?.input) ?? {};
        const output = asObject(state?.output) ?? {};
        entries.push({
          id: typeof part.id === "string" ? part.id : `${messageId}:tool-${partIndex}`,
          role: "tool",
          text: typeof part.tool === "string" ? part.tool : "Tool",
          ...(createdAt !== undefined ? { createdAt } : {}),
          toolType: "mcpToolCall",
          command: JSON.stringify(input),
          output: typeof output.value === "string" ? output.value : typeof state?.output === "string" ? state.output : "",
          status: typeof state?.status === "string" ? state.status : "completed",
        });
      }
    }
  }
  return entries;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function earliestCommunicationCreatedAt(communications: readonly { createdAt?: number }[]): number | undefined {
  const timestamps = communications.flatMap(({ createdAt }) =>
    typeof createdAt === "number" && Number.isFinite(createdAt) ? [createdAt] : []);
  return timestamps.length ? Math.min(...timestamps) : undefined;
}
