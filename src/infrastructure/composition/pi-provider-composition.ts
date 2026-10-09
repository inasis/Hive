import type { AssistantEventPublisher } from "../../application/ports/events.js";
import { PiSessionCatalogOperations } from "../providers/pi/session-catalog-operations.js";
import { PiCommandAdapter } from "../providers/pi/session-commands.js";
import { PiSessionContext } from "../providers/pi/session-context.js";
import { PiSessionConversationAdapter } from "../providers/pi/session-conversations.js";
import { PiSessionForkAdapter } from "../providers/pi/session-forks.js";
import { PiSessionLifecycleAdapter } from "../providers/pi/session-lifecycle.js";
import { PiThreadSettingsAdapter } from "../providers/pi/session-settings.js";
import { PiTurnAdapter } from "../providers/pi/session-turns.js";
import { PiTurnEventTracker } from "../providers/pi/turn-event-tracker.js";

/** Construct Pi's concrete session adapters, record tracking, and application ports. */
export function createPiProviderComposition(publishAssistantEvent: AssistantEventPublisher) {
  const context = new PiSessionContext();
  const turnEvents = new PiTurnEventTracker(publishAssistantEvent);
  const turns = new PiTurnAdapter(context, turnEvents);
  const onRecord = turnEvents.handleRecord.bind(turnEvents);
  const catalog = new PiSessionCatalogOperations(context);
  const conversations = new PiSessionConversationAdapter(context, onRecord);
  const sessions = new PiSessionLifecycleAdapter(context, onRecord, publishAssistantEvent);
  const forks = new PiSessionForkAdapter(context, onRecord);
  const commands = new PiCommandAdapter(context, turns, onRecord);
  const settings = new PiThreadSettingsAdapter(context, onRecord);

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
      approvals: {
        async answerApproval() {
          throw new Error("Pi handles tool execution inside its own RPC process and does not expose Hive approval requests.");
        },
      },
    },
  };
}
