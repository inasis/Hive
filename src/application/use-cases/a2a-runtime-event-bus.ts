import type {
  A2ARuntimeEvent,
  A2ARuntimeEventHandler,
} from "../ports/a2a-runtime.js";
import { copyEvent } from "../validation/a2a-runtime-copy.js";

/** Owns runtime event subscriptions and isolated event delivery. */
export class A2ARuntimeEventBus {
  private readonly listeners = new Set<A2ARuntimeEventHandler>();

  subscribe = (handler: A2ARuntimeEventHandler): (() => void) => {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  };

  publish = (event: A2ARuntimeEvent): void => {
    for (const listener of this.listeners) {
      try {
        listener(copyEvent(event));
      } catch {
        // Observability listeners must not disrupt task execution.
      }
    }
  };
}
