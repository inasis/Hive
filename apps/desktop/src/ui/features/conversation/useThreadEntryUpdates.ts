import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, TranscriptEntry } from "../../../shared/bridge";
import type { ConversationRuntimePort } from "../../shared/conversation-store";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import { hiveTranscriptCache } from "../../shared/hive-transcript-cache";
import { latestTranscriptEntries } from "../../shared/transcript-groups";

type ThreadEntriesUpdate = (current: TranscriptEntry[]) => TranscriptEntry[];

/** Keep the cached transcript and the selected conversation view in sync. */
export function useThreadEntryUpdates(dependencies: {
  store: ThreadViewStorePort;
  runtime: ConversationRuntimePort;
  setActiveEntries: Dispatch<SetStateAction<TranscriptEntry[]>>;
}): (target: string, provider: AssistantProvider, threadId: string, update: ThreadEntriesUpdate) => void {
  const { store, runtime, setActiveEntries } = dependencies;
  return useCallback((target: string, provider: AssistantProvider, threadId: string, update: ThreadEntriesUpdate) => {
    const view = store.get(target, provider, threadId);
    const isActive = runtime.isThreadSelected(target, provider, threadId);
    if (view) {
      const nextEntries = latestTranscriptEntries(update(view.entries), 20);
      const nextView = { ...view, entries: nextEntries };
      store.set(nextView);
      hiveTranscriptCache.saveRecent(nextView);
      if (isActive) setActiveEntries(nextEntries);
      return;
    }
    if (isActive) {
      setActiveEntries((current) => latestTranscriptEntries(update(current), 20));
    }
  }, [store, runtime, setActiveEntries]);
}
