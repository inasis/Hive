import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, TranscriptEntry } from "../../shared/bridge";
import { providerDisplayName } from "../../shared/provider-display-name";
import type { UiBridgeEvent } from "../../shared/bridge-events";
import type { ConversationRuntimePort } from "../../shared/conversation-store";

type ThreadEntryUpdate = (current: TranscriptEntry[]) => TranscriptEntry[];

export type TurnLifecycleEventDependencies = {
  eventProvider: AssistantProvider;
  isActiveThread: boolean;
  runtime: ConversationRuntimePort;
  setters: {
    setNotice: Dispatch<SetStateAction<string>>;
    setBusy: Dispatch<SetStateAction<boolean>>;
    setBusySince: Dispatch<SetStateAction<number | null>>;
    setActiveTurnId: Dispatch<SetStateAction<string>>;
    setStoppingTurn: Dispatch<SetStateAction<boolean>>;
    setSteeringPrompt: Dispatch<SetStateAction<boolean>>;
  };
  actions: {
    flushAssistantDeltas(): void;
    updateThreadEntries(target: string, provider: AssistantProvider, threadId: string, update: ThreadEntryUpdate): void;
  };
};

/** Apply turn state transitions before events are filtered by the selected provider. */
export function applyTurnLifecycleEvent(event: UiBridgeEvent, dependencies: TurnLifecycleEventDependencies): boolean {
  const { eventProvider, isActiveThread, runtime, setters, actions } = dependencies;
  if (event.type === "turnStarted") {
    const startedAt = runtime.runningSince(event.target, eventProvider, event.threadId) ?? Date.now();
    runtime.startThread(event.target, eventProvider, event.threadId, startedAt);
    runtime.observeTurnStart(event.target, eventProvider, event.threadId);
    if (event.turnId) {
      runtime.setTurnId(event.target, eventProvider, event.threadId, event.turnId);
      if (isActiveThread) setters.setActiveTurnId(event.turnId);
    }
    if (isActiveThread) {
      setters.setBusy(true);
      setters.setBusySince((current) => current ?? startedAt);
    }
    return true;
  }
  if (event.type === "turnCompleted") {
    const startedAt = runtime.runningSince(event.target, eventProvider, event.threadId);
    const responseDurationMs = startedAt === null ? undefined : Math.max(1_000, Date.now() - startedAt);
    const userInterrupted = runtime.completeTurn(event.target, eventProvider, event.threadId);
    actions.flushAssistantDeltas();
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, (current) => current.map((entry) =>
      entry.role === "assistant" && (event.turnId ? entry.turnId === event.turnId : entry.status === "inProgress" || entry.responseCompleted === false)
        ? {
            ...entry,
            status: event.error ? "failed" : "completed",
            responseCompleted: true,
            ...(responseDurationMs === undefined ? {} : { responseDurationMs }),
          }
        : entry,
    ));
    if (!isActiveThread) return true;
    setters.setBusy(false);
    setters.setActiveTurnId("");
    setters.setStoppingTurn(false);
    setters.setSteeringPrompt(false);
    setters.setBusySince(null);
    if (!userInterrupted && event.error) setters.setNotice(`${providerDisplayName(eventProvider)} 오류: ${event.error}`);
    return true;
  }
  return false;
}
