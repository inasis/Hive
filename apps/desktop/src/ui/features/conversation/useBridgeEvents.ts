import { useEffect } from "react";
import { addUiBridgeEventListener, removeUiBridgeEventListener } from "../../bridgeClient";
import type { UiBridgeEvent } from "../../shared/bridge-event-adapter";
import { applyConversationBridgeEvent, type BridgeEventHandlerDependencies } from "./conversation-bridge-event-handler";

/** Own the React subscription lifecycle for provider events and delegate event effects to the conversation feature. */
export function useBridgeEvents(dependencies: BridgeEventHandlerDependencies): void {
  const { context, setters, refs, actions } = dependencies;

  useEffect(() => {
    const onEvent = (event: UiBridgeEvent) => applyConversationBridgeEvent(event, dependencies);
    addUiBridgeEventListener(onEvent);
    return () => removeUiBridgeEventListener(onEvent);
  }, [context.connectedTarget, setters, refs, actions.updateThreadEntries, actions.flushAssistantDeltas, actions.enqueueAssistantDelta, actions.clearThreadDeltas]);
}
