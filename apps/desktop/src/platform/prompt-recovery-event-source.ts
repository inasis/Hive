import type {
  PromptRecoveryEvent,
  PromptRecoveryEventSourcePort,
} from "../../../../src/application/ports/prompt-recovery.js";
import type { UiBridgeEvent } from "../../../../src/presentation/shared/bridge-events";
import type { DesktopBridgeRuntimePort } from "../../../../src/presentation/shared/bridge-runtime";

/** Adapt normalized desktop bridge events to the prompt recovery use case contract. */
export class DesktopPromptRecoveryEventSource implements PromptRecoveryEventSourcePort {
  constructor(private readonly bridge: Pick<DesktopBridgeRuntimePort, "addBridgeEventListener" | "removeBridgeEventListener">) {}

  subscribe(listener: (event: PromptRecoveryEvent) => void): () => void {
    const onEvent = (event: UiBridgeEvent): void => {
      if (event.type === "transportDisconnected") listener({ type: event.type, target: event.target });
      else if (event.type === "transportFailed") {
        listener({ type: event.type, target: event.target, ...(event.message ? { message: event.message } : {}) });
      } else if (event.type === "turnStarted") {
        listener({
          type: event.type,
          target: event.target,
          threadId: event.threadId,
          ...(event.provider ? { provider: event.provider } : {}),
        });
      }
    };
    this.bridge.addBridgeEventListener(onEvent);
    return () => this.bridge.removeBridgeEventListener(onEvent);
  }
}
