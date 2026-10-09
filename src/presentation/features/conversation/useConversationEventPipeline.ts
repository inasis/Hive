import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { TranscriptEntry } from "../../shared/bridge";
import type { ConversationRuntimePort, ThreadViewStorePort } from "../../shared/conversation-store";
import type { BridgeEventSetters } from "./conversation-bridge-event-handler";
import { useBridgeEvents } from "./useBridgeEvents";
import { useThreadEntryUpdates } from "./useThreadEntryUpdates";
import { useTranscriptDeltaBuffer } from "./useTranscriptDeltaBuffer";
import { useTranscriptCache } from "../../shared/transcript-cache-context";

export function useConversationEventPipeline({
  connectedTarget,
  threadViews,
  runtime,
  setActiveEntries,
  setters,
}: {
  connectedTarget: string;
  threadViews: MutableRefObject<ThreadViewStorePort>;
  runtime: ConversationRuntimePort;
  setActiveEntries: Dispatch<SetStateAction<TranscriptEntry[]>>;
  setters: BridgeEventSetters;
}) {
  const transcriptCache = useTranscriptCache();
  const updateThreadEntries = useThreadEntryUpdates({
    store: threadViews.current,
    runtime,
    setActiveEntries,
  });
  const transcriptDeltas = useTranscriptDeltaBuffer(updateThreadEntries);
  const context = useMemo(() => ({ connectedTarget }), [connectedTarget]);
  const stableSetters = useMemo(() => setters, []);
  const refs = useMemo(() => ({ threadViews, runtime, transcriptCache }), [threadViews, runtime, transcriptCache]);
  const actions = useMemo(() => ({
    updateThreadEntries,
    flushAssistantDeltas: transcriptDeltas.flush,
    enqueueAssistantDelta: transcriptDeltas.enqueue,
    clearThreadDeltas: transcriptDeltas.clearThread,
  }), [
    updateThreadEntries,
    transcriptDeltas.flush,
    transcriptDeltas.enqueue,
    transcriptDeltas.clearThread,
  ]);

  useBridgeEvents({ context, setters: stableSetters, refs, actions });

  return {
    updateThreadEntries,
    flushAssistantDeltas: transcriptDeltas.flush,
    clearThreadDeltas: transcriptDeltas.clearThread,
    clearAssistantDeltas: transcriptDeltas.clear,
  };
}
