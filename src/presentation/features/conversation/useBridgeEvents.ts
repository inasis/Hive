import { useEffect } from "react";
import type { UiBridgeEvent } from "../../shared/bridge-events";
import { applyConversationBridgeEvent, type BridgeEventHandlerDependencies } from "./conversation-bridge-event-handler";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

/** Own the React subscription lifecycle for provider events and delegate event effects to the conversation feature. */
export function useBridgeEvents(dependencies: BridgeEventHandlerDependencies): void {
  const { bridge } = useDesktopUiRuntime();
  const { context, setters, refs, actions } = dependencies;

  useEffect(() => {
    const onEvent = (event: UiBridgeEvent) => applyConversationBridgeEvent(event, dependencies);
    bridge.addBridgeEventListener(onEvent);
    return () => bridge.removeBridgeEventListener(onEvent);
  }, [bridge, context.connectedTarget, setters, refs, refs.transcriptCache, actions.updateThreadEntries, actions.flushAssistantDeltas, actions.enqueueAssistantDelta, actions.clearThreadDeltas]);
}
