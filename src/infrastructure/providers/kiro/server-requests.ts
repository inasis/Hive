import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { WorkspaceFilePort } from "../../../application/ports/workspace-files.js";
import type { KiroServerRequest } from "./acp-rpc.js";
import { publishKiroEvent } from "./session-events.js";
import type { KiroRemoteSession } from "./session-types.js";
import { asObject, errorMessage, firstString, type JsonObject } from "./session-utils.js";
import { handleKiroTerminalRequest } from "./terminal-requests.js";
import { handleKiroWorkspaceRequest } from "./workspace-requests.js";

/** Handle ACP server calls that require Hive workspace and terminal capabilities. */
export function createKiroServerRequestHandler(
  workspaceFiles: WorkspaceFilePort,
  publish: AssistantEventPublisher,
): (session: KiroRemoteSession, target: string, request: KiroServerRequest) => Promise<void> {
  return async function handleKiroServerRequest(session, target, request): Promise<void> {
    try {
      if (/permission/i.test(request.method)) {
        const threadId = firstString(request.params.sessionId);
        if (!threadId) {
          session.connection.respond(request.id, { outcome: "cancelled" });
          return;
        }
        const options = (Array.isArray(request.params.options) ? request.params.options : []).map(asObject).filter((option): option is JsonObject => Boolean(option));
        session.pendingApprovals.set(String(request.id), { threadId, options });
        const toolCall = asObject(request.params.toolCall);
        const command = firstString(toolCall?.title);
        const reason = firstString(toolCall?.kind);
        publishKiroEvent(publish, target, threadId, {
          type: "approvalRequested",
          requestId: request.id,
          approval: {
            kind: "permission",
            ...(command ? { command } : {}),
            ...(firstString(request.params.cwd) ? { cwd: firstString(request.params.cwd)! } : {}),
            ...(reason ? { reason } : {}),
            ...(firstString(request.params.itemId, toolCall?.toolCallId) ? { itemId: firstString(request.params.itemId, toolCall?.toolCallId)! } : {}),
            ...(Array.isArray(request.params.options) ? {
              options: options.flatMap((option): Array<{ id: string; label: string; kind?: string }> => {
                const id = firstString(option.optionId, option.id);
                const label = firstString(option.name, option.label);
                return id && label ? [{ id, label, ...(firstString(option.kind) ? { kind: firstString(option.kind)! } : {}) }] : [];
              }),
            } : {}),
          },
        });
        return;
      }

      if (request.method === "fs/read_text_file" || request.method === "fs/write_text_file" || request.method.startsWith("terminal/")) {
        const threadId = firstString(request.params.sessionId);
        if (!threadId || !session.openedThreadIds.has(threadId)) throw new Error("Kiro ACP request refers to a session that is not open in Hive");
        const cwd = session.cwdByThread.get(threadId);
        if (!cwd) throw new Error("Kiro workspace path is unavailable for this session");
        if (request.method === "fs/read_text_file" || request.method === "fs/write_text_file") {
          await handleKiroWorkspaceRequest(workspaceFiles, session, target, cwd, request);
        } else {
          await handleKiroTerminalRequest(session, target, threadId, cwd, request);
        }
        return;
      }

      session.connection.respondError(request.id, -32601, `Unsupported Kiro ACP request: ${request.method}`);
    } catch (error) {
      session.connection.respondError(request.id, -32000, errorMessage(error));
    }
  };
}
