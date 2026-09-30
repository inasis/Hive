import { useCallback, useEffect, useRef } from "react";
import type { AssistantProvider, TranscriptEntry } from "../../../shared/bridge";
import { isAssistantProvider } from "../../../../../../src/domain/provider-catalog.js";
import { appendAssistantDelta } from "./transcript-state";
import { threadViewKey } from "../../shared/conversation-view";

type AssistantDelta = { text: string; turnId: string; providerMessageId: string };
type ThreadEntryUpdate = (current: TranscriptEntry[]) => TranscriptEntry[];

export type TranscriptDelta = {
  target: string;
  provider: AssistantProvider;
  threadId: string;
  turnId: string;
  providerMessageId: string;
  text: string;
};

/** Batch transcript deltas and flush them before final or thread-level updates. */
export function useTranscriptDeltaBuffer(updateThreadEntries: (
  target: string,
  provider: AssistantProvider,
  threadId: string,
  update: ThreadEntryUpdate,
) => void) {
  const pending = useRef(new Map<string, AssistantDelta>());
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const updates = [...pending.current];
    pending.current.clear();
    for (const [key, delta] of updates) {
      const [target, provider, threadId, messageId] = key.split("\0");
      if (target && isAssistantProvider(provider) && threadId && messageId) {
        updateThreadEntries(target, provider, threadId, (current) =>
          appendAssistantDelta(current, messageId, delta.text, delta.turnId, delta.providerMessageId));
      }
    }
  }, [updateThreadEntries]);

  const enqueue = useCallback((delta: TranscriptDelta) => {
    if (!delta.text) return;
    const messageId = `${delta.turnId}:${delta.providerMessageId}`;
    const key = `${threadViewKey(delta.target, delta.provider, delta.threadId)}\0${messageId}`;
    const previous = pending.current.get(key);
    pending.current.set(key, {
      text: (previous?.text ?? "") + delta.text,
      turnId: delta.turnId,
      providerMessageId: delta.providerMessageId,
    });
    if (timer.current === null) timer.current = window.setTimeout(flush, 50);
  }, [flush]);

  const clearThread = useCallback((target: string, provider: AssistantProvider, threadId: string) => {
    const prefix = `${threadViewKey(target, provider, threadId)}\0`;
    for (const key of pending.current.keys()) {
      if (key.startsWith(prefix)) pending.current.delete(key);
    }
    if (!pending.current.size && timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    pending.current.clear();
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  return { enqueue, flush, clearThread, clear };
}
