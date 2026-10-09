import type { AssistantEventPublisher } from "../../application/ports/events.js";
import { OpenCodeSessionCatalogAdapter } from "../providers/opencode/session-catalog.js";
import { OpenCodeCommandAdapter } from "../providers/opencode/session-commands.js";
import { OpenCodeSessionContext } from "../providers/opencode/session-context.js";
import { OpenCodeSessionForkAdapter } from "../providers/opencode/session-forks.js";
import { OpenCodeSessionSettingsAdapter } from "../providers/opencode/session-settings.js";
import { OpenCodeTurnAdapter } from "../providers/opencode/session-turns.js";

/** Construct OpenCode's concrete session adapters and application ports. */
export function createOpenCodeProviderComposition(publishAssistantEvent: AssistantEventPublisher) {
  const context = new OpenCodeSessionContext();
  const catalog = new OpenCodeSessionCatalogAdapter(context);
  const forks = new OpenCodeSessionForkAdapter(context);
  const publishOpenCodeEvent: AssistantEventPublisher = (event) => publishAssistantEvent({ ...event, provider: "opencode" });
  const commands = new OpenCodeCommandAdapter(context, publishOpenCodeEvent);
  const settings = new OpenCodeSessionSettingsAdapter(context);
  const turns = new OpenCodeTurnAdapter(context, publishOpenCodeEvent);

  return {
    context,
    ports: {
      catalogs: catalog,
      sessions: catalog,
      conversations: catalog,
      forks,
      skills: commands,
      commands,
      turns,
      settings,
      approvals: turns,
    },
  };
}
