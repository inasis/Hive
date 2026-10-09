import type { AssistantEventPublisher } from "../../application/ports/events.js";
import type { CodexCliEvent } from "../../application/ports/codex-cli.js";
import { CodexSessionCatalogOperations } from "../providers/codex/session-catalog-operations.js";
import { CodexCliSessionOpener } from "../providers/codex/session-cli-opener.js";
import { CodexSessionCommandAdapter } from "../providers/codex/session-commands.js";
import { CodexSessionContext } from "../providers/codex/session-context.js";
import { CodexSessionConversationAdapter } from "../providers/codex/session-conversations.js";
import { CodexSessionForkAdapter } from "../providers/codex/session-forks.js";
import { CodexSessionLifecycleAdapter } from "../providers/codex/session-lifecycle.js";
import { handleCodexNotification } from "../providers/codex/notifications.js";
import { CodexSessionSettingsAdapter } from "../providers/codex/session-settings.js";
import { CodexSessionTurnAdapter } from "../providers/codex/session-turns.js";

/** Construct Codex's concrete session adapters and application ports. */
export function createCodexProviderComposition(
  publishAssistantEvent: AssistantEventPublisher,
  publishCodexCliEvent?: (event: CodexCliEvent) => void,
) {
  const context = new CodexSessionContext((target, session, method, params, requestId) =>
    handleCodexNotification(publishAssistantEvent, target, session, method, params, requestId), publishCodexCliEvent);
  const catalog = new CodexSessionCatalogOperations(context);
  const conversations = new CodexSessionConversationAdapter(context);
  const cliSessions = new CodexCliSessionOpener(context);
  const commands = new CodexSessionCommandAdapter(context);
  const forks = new CodexSessionForkAdapter(context);
  const sessions = new CodexSessionLifecycleAdapter(context);
  const settings = new CodexSessionSettingsAdapter(context);
  const turns = new CodexSessionTurnAdapter(context);

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
      cliSessions,
      cliSkills: commands,
    },
  };
}
