import { useCallback } from "react";
import type { AssistantProvider, TranscriptEntry } from "../../../shared/bridge";
import type { ConversationRuntime } from "./useConversationRuntime";
import type { ThreadViewStore } from "./thread-view-store";

type ThreadEntriesUpdate = (current: TranscriptEntry[]) => TranscriptEntry[];

/** Keep the cached transcript and the selected conversation view in sync. */
export function useThreadEntryUpdates(dependencies: {
  store: ThreadViewStore;
  runtime: ConversationRuntime;
  setActiveEntries: (entries: TranscriptEntry[]) => void;
}): (target: string, provider: AssistantProvider, threadId: string, update: ThreadEntriesUpdate) => void {
  const { store, runtime, setActiveEntries } = dependencies;
  return useCallback((target: string, provider: AssistantProvider, threadId: string, update: ThreadEntriesUpdate) => {
    const view = store.get(target, provider, threadId);
    const nextEntries = update(view?.entries ?? []);
    if (view) store.update(target, provider, threadId, (current) => ({ ...current, entries: nextEntries }));
    if (runtime.isThreadSelected(target, provider, threadId)) setActiveEntries(nextEntries);
  }, [store, runtime, setActiveEntries]);
}
