import type { AssistantEventInput, AssistantEventPublisher } from "../../../application/ports/events.js";
import { collectKiroTranscript, kiroContentText, kiroUpdateKind } from "./session-update-mapper.js";
import type { KiroRemoteSession } from "./session-context.js";
import { firstString, type JsonObject } from "./session-utils.js";

export function publishKiroEvent(
  publish: AssistantEventPublisher,
  target: string,
  threadId: string,
  event: AssistantEventInput,
): void {
  publish({
    ...event,
    target,
    threadId,
    provider: "kiro",
  });
}

export function subscribeKiroSession(
  session: KiroRemoteSession,
  target: string,
  threadId: string,
  publish: AssistantEventPublisher,
): void {
  session.updateUnsubscribers.get(threadId)?.();
  const unsubscribe = session.connection.onSessionUpdate(threadId, ({ update }) => {
    const transcript = session.transcriptsByThread.get(threadId);
    if (transcript) collectKiroTranscript(transcript, update);
    publishKiroSessionUpdate(session, target, threadId, update, publish);
  });
  session.updateUnsubscribers.set(threadId, unsubscribe);
}

function publishKiroSessionUpdate(
  session: KiroRemoteSession,
  target: string,
  threadId: string,
  update: JsonObject,
  publish: AssistantEventPublisher,
): void {
  const kind = kiroUpdateKind(update);
  const turnId = firstString(update.turnId, update.turn_id, session.activeTurnIds.get(threadId)) ?? "turn";
  if (kind === "agent_message_chunk") {
    const text = kiroContentText(update.content ?? update.text);
    if (!text) return;
    const itemId = firstString(update.messageId, update.itemId, update.id) ?? "kiro-agent-message";
    publishKiroEvent(publish, target, threadId, { type: "assistantDelta", turnId, messageId: itemId, text });
    return;
  }
  if (kind === "tool_call") {
    const id = firstString(update.toolCallId, update.id) ?? `kiro-tool-${Date.now()}`;
    const title = firstString(update.title, update.name) ?? "Kiro tool";
    publishKiroEvent(publish, target, threadId, {
      type: "toolStarted",
      turnId,
      activity: { kind: "commandExecution", id, command: title, status: "inProgress" },
    });
    return;
  }
  if (kind === "tool_call_update") {
    const id = firstString(update.toolCallId, update.id) ?? `kiro-tool-${Date.now()}`;
    const title = firstString(update.title, update.name) ?? "Kiro tool";
    const status = firstString(update.status) ?? "completed";
    const output = kiroContentText(update.rawOutput ?? update.content ?? update.output);
    publishKiroEvent(publish, target, threadId, {
      type: "toolCompleted",
      turnId,
      activity: { kind: "commandExecution", id, command: title, status, output },
    });
    return;
  }
  if (kind === "session_info_update") {
    const title = firstString(update.title, update.sessionName);
    if (title) publishKiroEvent(publish, target, threadId, { type: "threadRenamed", title });
  }
}
