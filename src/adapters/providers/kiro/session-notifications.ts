import type { AssistantCommand } from "../../../domain/assistant.js";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { KiroNotification } from "./acp-rpc.js";
import { publishKiroEvent } from "./session-events.js";
import type { KiroRemoteSession } from "./session-context.js";
import { asObject, firstString } from "./session-utils.js";
import { kiroUpdateKind } from "./session-update-mapper.js";

export function handleKiroNotification(
  session: KiroRemoteSession,
  target: string,
  notification: KiroNotification,
  publish: AssistantEventPublisher,
): void {
  const threadId = firstString(notification.params.sessionId, notification.params.threadId) ?? [...session.openedThreadIds].at(-1);
  if (notification.method === "_kiro.dev/mcp/oauth_request" && threadId) {
    const server = firstString(notification.params.serverName, notification.params.name, asObject(notification.params.server)?.name) ?? "MCP";
    const authorizationUrl = firstString(notification.params.authorizationUrl, notification.params.authUrl, notification.params.oauthUrl, notification.params.url);
    publishKiroEvent(publish, target, threadId, {
      type: "warning",
      message: `${server} MCP 서버에 OAuth 인증이 필요합니다${authorizationUrl ? `: ${authorizationUrl}` : ". Kiro CLI에서 인증을 완료하세요."}`,
    });
    return;
  }
  if (notification.method === "_kiro.dev/mcp/server_initialized" && threadId) {
    const server = firstString(notification.params.serverName, notification.params.name, asObject(notification.params.server)?.name) ?? "MCP";
    publishKiroEvent(publish, target, threadId, { type: "warning", message: `${server} MCP 서버가 준비되었습니다.` });
    return;
  }
  if ((notification.method === "_kiro.dev/compaction/status" || notification.method === "_kiro.dev/clear/status") && threadId) {
    const status = firstString(notification.params.message, notification.params.status, notification.params.state, notification.params.phase);
    if (status) {
      const operation = notification.method === "_kiro.dev/compaction/status" ? "맥락 압축" : "대화 지우기";
      publishKiroEvent(publish, target, threadId, { type: "warning", message: `Kiro ${operation}: ${status}` });
    }
    return;
  }
  if (notification.method === "_kiro.dev/commands/available" && threadId) {
    const values = Array.isArray(notification.params.commands) ? notification.params.commands :
      Array.isArray(notification.params.availableCommands) ? notification.params.availableCommands : [];
    const commands = values.flatMap((value): AssistantCommand[] => {
      const item = asObject(value);
      const rawName = firstString(item?.name, item?.command);
      if (!item || !rawName) return [];
      const name = rawName.replace(/^\/+/, "");
      if (!/^[A-Za-z0-9._/-]{1,128}$/.test(name)) return [];
      const meta = asObject(item.meta);
      return [{ name, description: firstString(item.description) ?? "", provider: "Kiro", takesArguments: Boolean(meta?.inputType && meta.inputType !== "none") }];
    });
    session.commandsByThread.set(threadId, commands);
    publishKiroEvent(publish, target, threadId, { type: "commandsUpdated", commands });
    return;
  }
  if (notification.method === "session/update" && threadId) {
    const update = asObject(notification.params.update) ?? {};
    const kind = kiroUpdateKind(update);
    if (kind === "current_mode_update") {
      const modeId = firstString(update.currentModeId, update.modeId);
      if (modeId) {
        session.currentModeByThread.set(threadId, modeId);
        publishKiroEvent(publish, target, threadId, { type: "threadSettingsUpdated", settings: { currentModeId: modeId } });
      }
    }
  }
}
