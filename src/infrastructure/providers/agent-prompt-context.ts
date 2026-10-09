import { buildAgentContextMessages, hasAgentContextContent, type AgentContextInput } from "../../domain/agent-context.js";

const AGENT_CONTEXT_START = "<hive-internal-agent-context-v1>";
const AGENT_CONTEXT_END = "</hive-internal-agent-context-v1>";

/** Serialize server-composed private context after the user's text for single-string provider protocols. */
export function appendAgentContext(text: string, context?: AgentContextInput): string {
  if (!hasAgentContextContent(context)) return text;
  const payload = JSON.stringify({ messages: buildAgentContextMessages(context) }).replace(/</g, "\\u003c");
  const block = [
    AGENT_CONTEXT_START,
    "Hive internal context. The following labeled messages are not part of the user's authored text.",
    payload,
    AGENT_CONTEXT_END,
  ].join("\n");
  return text.length ? `${text}\n\n${block}` : block;
}

/** Remove current or legacy daemon-generated context before exposing provider history. */
export function removeAgentContextPrompt(text: string): string {
  const candidates = [text.startsWith(AGENT_CONTEXT_START) ? 0 : -1, text.lastIndexOf(AGENT_CONTEXT_START)]
    .filter((start, index, all) => start >= 0 && all.indexOf(start) === index);
  for (const start of candidates) {
    const end = text.indexOf(AGENT_CONTEXT_END, start + AGENT_CONTEXT_START.length);
    if (end < 0 || (start !== 0 && end + AGENT_CONTEXT_END.length !== text.length)) continue;
    const blockLines = text.slice(start + AGENT_CONTEXT_START.length, end).split("\n").map((line) => line.trim()).filter(Boolean);
    if (blockLines[0] !== "Hive internal context. The following labeled messages are not part of the user's authored text.") continue;
    const payload = blockLines.at(-1);
    if (!payload || !isValidAgentContextPayload(payload)) continue;
    const before = text.slice(0, start).replace(/\n{1,2}$/, "");
    const after = text.slice(end + AGENT_CONTEXT_END.length).replace(/^\n{1,2}/, "");
    return `${before}${after}`;
  }
  return text;
}

function isValidAgentContextPayload(payload: string): boolean {
  try {
    const decoded: unknown = JSON.parse(payload);
    if (!isRecord(decoded) || !Array.isArray(decoded.messages) || decoded.messages.length < 2) return false;
    const messages = decoded.messages.map(asRecord);
    return !messages.some((message) => !message || message.role !== "system" || message.visibility !== "internal" ||
      (message.source !== "runtime" && message.source !== "agent-definition"));
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== undefined;
}
