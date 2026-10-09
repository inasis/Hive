import type { AssistantEventInput, AssistantEventPublisher } from "../../../application/ports/events.js";
import { collectKiroTranscript, isKiroPermissionFailureOutput, kiroContentText, kiroToolStatus, kiroUpdateKind } from "./session-update-mapper.js";
import type { KiroRemoteSession } from "./session-types.js";
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
    const activeTurnId = session.activeTurnIds.get(threadId);
    const transcript = session.transcriptsByThread.get(threadId);
    if (transcript) collectKiroTranscript(transcript, update, activeTurnId, Date.now());
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
  const activeTurnId = session.activeTurnIds.get(threadId);
  const turnId = activeTurnId ?? firstString(update.turnId, update.turn_id) ?? "turn";
  if (kind === "agent_message_chunk") {
    const text = kiroContentText(update.content ?? update.text);
    if (!text) return;
    const itemId = firstString(update.messageId, update.itemId, update.id) ?? "kiro-agent-message";
    publishKiroEvent(publish, target, threadId, { type: "assistantDelta", turnId, messageId: itemId, text });
    return;
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const id = firstString(update.toolCallId, update.id) ?? `kiro-tool-${Date.now()}`;
    const previous = session.transcriptsByThread.get(threadId)?.find((entry) => entry.id === id);
    const title = firstString(update.title, update.name, previous?.command) ?? "Kiro tool";
    const previousStatus = previous?.status;
    const output = kiroContentText(update.rawOutput ?? update.content ?? update.output) || previous?.output || "";
    const permissionFailure = isKiroPermissionFailureOutput(output);
    const status = permissionFailure ? "failed" : kiroToolStatus(update.status, previousStatus ?? "inProgress");
    if (status === "failed") {
      const failedTurnId = activeTurnId ?? firstString(update.turnId, update.turn_id);
      if (failedTurnId) {
        session.toolFailuresByThread.set(threadId, {
          turnId: failedTurnId,
          message: permissionFailure
            ? "Kiro가 도구 권한을 거부해 요청을 중단했습니다. 세션 권한과 Kiro의 작업 공간·관리자 정책을 확인하세요."
            : "Kiro 도구 실행에 실패했습니다. 도구 기록에서 실패 내용을 확인하세요.",
        });
      }
    }
    publishKiroEvent(publish, target, threadId, {
      type: status === "inProgress" ? "toolStarted" : "toolCompleted",
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
