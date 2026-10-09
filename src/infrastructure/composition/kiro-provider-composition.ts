import type { AssistantEventPublisher } from "../../application/ports/events.js";
import type { WorkspaceFilePort } from "../../application/ports/workspace-files.js";
import { createKiroServerRequestHandler } from "../providers/kiro/server-requests.js";
import { KiroSessionCatalogOperations } from "../providers/kiro/session-catalog-operations.js";
import { KiroSessionCommandAdapter } from "../providers/kiro/session-commands.js";
import { KiroSessionContext } from "../providers/kiro/session-context.js";
import { KiroSessionConversationAdapter } from "../providers/kiro/session-conversations.js";
import { KiroSessionForkAdapter } from "../providers/kiro/session-forks.js";
import { KiroSessionLifecycleAdapter } from "../providers/kiro/session-lifecycle.js";
import { handleKiroNotification } from "../providers/kiro/session-notifications.js";
import { KiroSessionSettingsAdapter } from "../providers/kiro/session-settings.js";
import { KiroSessionTurnAdapter } from "../providers/kiro/session-turns.js";

/** Construct Kiro's ACP callbacks, concrete session adapters, and application ports. */
export function createKiroProviderComposition(
  workspaceFiles: WorkspaceFilePort,
  publishAssistantEvent: AssistantEventPublisher,
) {
  const serverRequestHandler = createKiroServerRequestHandler(workspaceFiles, publishAssistantEvent);
  const context = new KiroSessionContext(
    serverRequestHandler,
    (session, target, notification) => handleKiroNotification(session, target, notification, publishAssistantEvent),
  );
  const catalog = new KiroSessionCatalogOperations(context);
  const conversations = new KiroSessionConversationAdapter(context, publishAssistantEvent);
  const sessions = new KiroSessionLifecycleAdapter(context);
  const requireOpenThread = (target: string, threadId: string) => conversations.requireOpenThread(target, threadId);
  const forks = new KiroSessionForkAdapter(requireOpenThread, publishAssistantEvent);
  const commands = new KiroSessionCommandAdapter(
    requireOpenThread,
    (session, target, threadId, turnId, title) => forks.rewindConversation(session, target, threadId, turnId, title),
    publishAssistantEvent,
  );
  const settings = new KiroSessionSettingsAdapter(requireOpenThread, publishAssistantEvent);
  const turns = new KiroSessionTurnAdapter(context, requireOpenThread, publishAssistantEvent);

  return {
    context,
    ports: {
      catalogs: catalog,
      sessions,
      conversations,
      forks,
      skills: commands,
      commands,
      turns,
      settings,
      approvals: turns,
    },
  };
}
