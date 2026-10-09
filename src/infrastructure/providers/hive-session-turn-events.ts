import type { AssistantEvent } from "../../application/ports/events.js";
import type { HiveSessionAddress } from "./hive-session-agent-address.js";
import type { ActiveTask, TurnCompletion } from "./hive-session-turn-registry.js";

/** Tracks provider events for one temporary A2A turn and joins them with prompt acceptance. */
export class HiveSessionTaskTurnEvents {
  constructor(
    private readonly provider: string,
    private readonly subscribe: (handler: (event: AssistantEvent) => void) => () => void,
  ) {}

  observe(address: HiveSessionAddress, active: ActiveTask): () => void {
    return this.subscribe((event) => {
      if (event.provider !== this.provider || event.target !== address.target || event.threadId !== address.threadId) return;
      if (event.type === "turnStarted" && event.turnId && !active.turnId) active.turnId = event.turnId;
      if (event.type === "assistantDelta" || event.type === "assistantMessageCompleted") {
        if (active.turnId && event.turnId !== active.turnId) return;
        const previous = active.messages.get(event.messageId) ?? "";
        active.messages.set(event.messageId, event.type === "assistantDelta" ? previous + event.text : event.text);
        return;
      }
      if (event.type !== "turnCompleted") return;
      if (active.turnId && event.turnId && active.turnId !== event.turnId) return;
      if (!active.turnId && event.turnId) active.turnId = event.turnId;
      active.completion = event;
      if (active.accepted) active.resolveCompletion(event);
    });
  }

  markAccepted(active: ActiveTask, turnId?: string): void {
    active.accepted = true;
    if (turnId) active.turnId = turnId;
    if (active.completion) active.resolveCompletion(active.completion);
  }

  waitForCompletion(active: ActiveTask, signal: AbortSignal): Promise<TurnCompletion> {
    if (signal.aborted) return Promise.reject(new Error("A2A task was cancelled"));
    return new Promise<TurnCompletion>((resolve, reject) => {
      const onAbort = (): void => reject(new Error("A2A task was cancelled"));
      signal.addEventListener("abort", onAbort, { once: true });
      active.completionPromise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }
}
