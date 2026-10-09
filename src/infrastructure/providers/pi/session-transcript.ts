import type { TranscriptEntry } from "../../../domain/assistant.js";
import { providerA2ASummaryEntryId, providerPromptTranscript } from "../a2a-prompt-context.js";
import { asObject } from "./session-json-values.js";

export function mapPiTranscript(messagesValue: unknown, forksValue: unknown): TranscriptEntry[] {
  const messages = Array.isArray(messagesValue) ? messagesValue : [];
  const forkRows = Array.isArray(forksValue) ? forksValue.flatMap((value) => {
    const row = asObject(value);
    return row && typeof row.entryId === "string" && typeof row.text === "string"
      ? [{ entryId: row.entryId, text: row.text }]
      : [];
  }) : [];
  const entries: TranscriptEntry[] = [];
  const calls = new Map<string, TranscriptEntry>();
  let userIndex = 0;
  let currentTurnId: string | undefined;

  for (const [index, value] of messages.entries()) {
    const message = asObject(value);
    if (!message) continue;
    const role = typeof message.role === "string" ? message.role : "";
    const text = messageText(message.content);
    const createdAt = timestampMillis(message.timestamp);
    if (role === "user") {
      const fork = matchForkMessage(forkRows[userIndex++], text);
      currentTurnId = fork?.entryId ?? `pi-user-${index}`;
      const prompt = providerPromptTranscript(text);
      const promptCreatedAt = earliestCommunicationCreatedAt(prompt.communications) ?? createdAt;
      if (prompt.text.trim()) entries.push({
        id: currentTurnId,
        providerMessageId: currentTurnId,
        turnId: currentTurnId,
        role: "user",
        text: prompt.text,
        ...(createdAt !== undefined ? { createdAt } : {}),
        responseCompleted: true,
      });
      if (prompt.communications.length) entries.push({
        id: providerA2ASummaryEntryId(prompt.communications),
        role: "communication",
        text: "",
        turnId: currentTurnId,
        ...(promptCreatedAt !== undefined ? { createdAt: promptCreatedAt } : {}),
        communications: prompt.communications,
      });
      appendImageNotes(entries, currentTurnId, message.content);
      continue;
    }
    if (role === "assistant") {
      if (text.trim()) entries.push({
        id: `pi-assistant-${index}`,
        providerMessageId: currentTurnId ?? `pi-assistant-${index}`,
        ...(currentTurnId ? { turnId: currentTurnId } : {}),
        role: "assistant",
        text,
        ...(createdAt !== undefined ? { createdAt } : {}),
        responseCompleted: true,
      });
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const blockValue of blocks) {
        const block = asObject(blockValue);
        if (!block || block.type !== "toolCall") continue;
        const id = stringValue(block.id) ?? `pi-tool-${entries.length}`;
        const args = asObject(block.arguments) ?? {};
        const tool: TranscriptEntry = {
          id,
          role: "tool",
          text: stringValue(block.name) ?? "Pi tool",
          ...(createdAt !== undefined ? { createdAt } : {}),
          toolType: "commandExecution",
          command: JSON.stringify(args),
          output: "",
          status: "running",
        };
        entries.push(tool);
        calls.set(id, tool);
      }
      continue;
    }
    if (role === "toolResult") {
      const id = stringValue(message.toolCallId);
      const existing = id ? calls.get(id) : undefined;
      if (existing) {
        existing.output = messageText(message.content);
        existing.status = message.isError === true ? "failed" : "completed";
      } else {
        entries.push({
          id: id ?? `pi-tool-result-${index}`,
          role: "tool",
          text: stringValue(message.toolName) ?? "Pi tool",
          ...(createdAt !== undefined ? { createdAt } : {}),
          toolType: "commandExecution",
          output: messageText(message.content),
          status: message.isError === true ? "failed" : "completed",
        });
      }
    }
  }
  return entries;
}

export function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((blockValue) => {
    const block = asObject(blockValue);
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  }).join("\n");
}

function matchForkMessage(row: { entryId: string; text: string } | undefined, text: string): { entryId: string } | undefined {
  if (!row) return undefined;
  return row.text === text ? { entryId: row.entryId } : undefined;
}

function appendImageNotes(entries: TranscriptEntry[], turnId: string, value: unknown): void {
  if (!Array.isArray(value)) return;
  const images = value.flatMap((partValue) => {
    const part = asObject(partValue);
    return part?.type === "image" && typeof part.mimeType === "string"
      ? [{ name: "image", mimeType: part.mimeType, data: typeof part.data === "string" ? part.data : "" }]
      : [];
  });
  if (images.length) entries.push({
    id: `${turnId}:images`,
    turnId,
    role: "user",
    text: "",
    images,
    responseCompleted: true,
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function timestampMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value < 100_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function earliestCommunicationCreatedAt(communications: readonly { createdAt?: number }[]): number | undefined {
  const timestamps = communications.flatMap(({ createdAt }) =>
    typeof createdAt === "number" && Number.isFinite(createdAt) ? [createdAt] : []);
  return timestamps.length ? Math.min(...timestamps) : undefined;
}
