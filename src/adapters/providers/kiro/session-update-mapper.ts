import type { TranscriptEntry } from "../../../domain/assistant.js";
import { asObject, firstString, type JsonObject } from "./session-utils.js";

/** Fold ACP session updates into Hive's stable transcript entry model. */
export function collectKiroTranscript(entries: TranscriptEntry[], update: JsonObject, activeTurnId?: string): void {
  const kind = kiroUpdateKind(update);
  const explicitTurnId = activeTurnId ?? firstString(update.turnId, update.turn_id);
  const lastUser = [...entries].reverse().find((entry) => entry.role === "user");
  const lastAssistant = [...entries].reverse().find((entry) => entry.role === "assistant");
  if (explicitTurnId && lastUser) lastUser.turnId = explicitTurnId;
  const isUserChunk = kind === "user_message_chunk";
  const userCount = entries.filter((entry) => entry.role === "user").length;
  const turnId = explicitTurnId ?? (isUserChunk
    ? (entries.at(-1)?.role === "user" ? lastUser?.turnId : undefined)
    : lastUser?.turnId ?? lastAssistant?.turnId) ?? `kiro-turn-${userCount}`;
  if (kind === "user_message_chunk" || kind === "agent_message_chunk") {
    const role = kind === "user_message_chunk" ? "user" : "assistant";
    const text = kiroContentText(update.content ?? update.text);
    if (!text) return;
    if (role === "user") {
      for (const entry of [...entries].reverse()) {
        if (entry.role === "assistant" && entry.responseCompleted === false) {
          entry.responseCompleted = true;
          entry.status = "completed";
        }
      }
    }
    if (role === "user" && lastUser && (lastUser.text === text || lastUser.text.startsWith(text))) return;
    const providerMessageId = firstString(update.messageId, update.itemId, update.id);
    const previous = [...entries].reverse().find((entry) => entry.role === role && entry.turnId === turnId &&
      (!providerMessageId || !entry.providerMessageId || entry.providerMessageId === providerMessageId));
    if (previous) previous.text += text;
    else entries.push({
      id: `kiro-${role}-${turnId}-${entries.length}`,
      role,
      text,
      turnId,
      ...(role === "assistant" ? { providerMessageId: providerMessageId ?? `kiro-message-${entries.length}`, responseCompleted: false, status: "inProgress" } : {}),
    });
    return;
  }
  if (kind === "turn_end" || kind === "turn_complete" || kind === "turn_completed") {
    for (const entry of [...entries].reverse()) {
      if (entry.role === "assistant" && (entry.turnId === turnId || !explicitTurnId && entry.responseCompleted === false)) {
        entry.responseCompleted = true;
        entry.status = "completed";
        break;
      }
    }
    return;
  }
  if (kind !== "tool_call" && kind !== "tool_call_update") return;
  const id = firstString(update.toolCallId, update.id) ?? `kiro-tool-${entries.length}`;
  const previous = entries.find((candidate) => candidate.id === id);
  const title = firstString(update.title, update.name, previous?.command) ?? "Kiro tool";
  const output = kiroContentText(update.rawOutput ?? update.content ?? update.output) || previous?.output || "";
  const status = isKiroPermissionFailureOutput(output) ? "failed" : kiroToolStatus(update.status, previous?.status ?? "inProgress");
  const entry: TranscriptEntry = {
    id,
    role: "tool",
    text: status,
    toolType: "commandExecution",
    command: title,
    output,
    status,
  };
  const previousIndex = entries.findIndex((candidate) => candidate.id === id);
  if (previousIndex >= 0) entries[previousIndex] = entry;
  else entries.push(entry);
}

/** Convert ACP tool states to the stable status values rendered by Hive. */
export function kiroToolStatus(value: unknown, fallback = "inProgress"): string {
  const status = firstString(value);
  if (!status) return fallback;
  const normalized = status.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[ -]/g, "_").toLowerCase();
  if (normalized === "pending" || normalized === "in_progress" || normalized === "running" || normalized === "started") {
    return "inProgress";
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "success" || normalized === "succeeded") {
    return "completed";
  }
  if (["failed", "error", "denied", "rejected", "blocked"].includes(normalized)) return "failed";
  if (normalized === "cancelled" || normalized === "canceled") return "completed";
  return status;
}

export function isKiroPermissionFailureOutput(output: string): boolean {
  return /\b(?:permission|authorization)\s+(?:was\s+)?(?:denied|rejected|not granted|insufficient)|\baccess denied\b|\bnot authorized\b|\bunauthorized\b|\bforbidden\b|\bnot allowed\b|\bnot trusted\b|\bapproval (?:was )?(?:denied|rejected|required)\b|\bblocked by (?:the )?(?:policy|sandbox)\b|\b(?:missing|required|insufficient)\s+permissions?\b/i.test(output);
}

export function kiroUpdateKind(update: JsonObject): string {
  const value = firstString(update.sessionUpdate, update.type, update.kind) ?? "";
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[ -]/g, "_").toLowerCase();
}

export function kiroContentText(value: unknown): string {
  if (typeof value === "string") return value;
  const content = asObject(value);
  if (content) return firstString(content.text, content.outputText, content.inputText) ?? "";
  return Array.isArray(value)
    ? value.map((part) => typeof part === "string" ? part : firstString(asObject(part)?.text, asObject(part)?.outputText, asObject(part)?.inputText) ?? "").filter(Boolean).join("\n")
    : "";
}
