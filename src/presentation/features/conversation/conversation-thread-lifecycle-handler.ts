import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../shared/bridge";
import type { UiBridgeEvent } from "../../shared/bridge-events";
import type { SideChatTab } from "../../shared/conversation-view";
import type { ThreadViewStorePort, ConversationRuntimePort } from "../../shared/conversation-store";
import type { TranscriptCachePort } from "../../../application/ports/transcript-cache.js";
import { upsertProviderThreads } from "../../shared/provider-thread-state";

export type ThreadLifecycleBridgeEventDependencies = {
  eventProvider: AssistantProvider;
  currentTarget: boolean;
  isActiveThread: boolean;
  setters: {
    setThreads: Dispatch<SetStateAction<RemoteThread[]>>;
    setActiveTitle: Dispatch<SetStateAction<string>>;
    setSideChats: Dispatch<SetStateAction<SideChatTab[]>>;
  };
  refs: {
    threadViews: MutableRefObject<ThreadViewStorePort>;
    runtime: ConversationRuntimePort;
    transcriptCache: TranscriptCachePort;
  };
  actions: {
    clearThreadDeltas(target: string, provider: AssistantProvider, threadId: string): void;
  };
};

/** Apply thread catalog lifecycle events and clear state owned by a deleted thread. */
export function applyThreadLifecycleBridgeEvent(
  event: UiBridgeEvent,
  dependencies: ThreadLifecycleBridgeEventDependencies,
): boolean {
  const { eventProvider, currentTarget, isActiveThread, setters, refs, actions } = dependencies;
  if (event.type === "threadCreated") {
    if (!currentTarget) return true;
    setters.setThreads((current) => upsertProviderThreads(current, [{
      id: event.threadId,
      provider: eventProvider,
      title: event.title,
      cwd: event.cwd,
      preview: event.preview,
      updatedAt: event.updatedAt,
      ...(event.hiveSessionId ? { hiveSessionId: event.hiveSessionId } : {}),
    }], eventProvider));
    return true;
  }
  if (event.type === "threadRenamed") {
    if (currentTarget) setters.setThreads((current) => current.map((thread) => thread.provider === eventProvider && thread.id === event.threadId ? { ...thread, title: event.title } : thread));
    refs.threadViews.current.update(event.target, eventProvider, event.threadId, (view) => ({ ...view, title: event.title }));
    if (isActiveThread) setters.setActiveTitle(event.title);
    return true;
  }
  if (event.type === "threadDeleted") {
    const deletedThreadId = event.threadId;
    refs.threadViews.current.delete(event.target, eventProvider, deletedThreadId);
    void refs.transcriptCache.delete(event.target, eventProvider, deletedThreadId);
    refs.runtime.clearThread(event.target, eventProvider, deletedThreadId);
    if (currentTarget) setters.setThreads((current) => current.filter((thread) => thread.provider !== eventProvider || thread.id !== deletedThreadId));
    setters.setSideChats((current) => current.filter((chat) => chat.target !== event.target || chat.provider !== eventProvider || (chat.threadId !== deletedThreadId && chat.rootThreadId !== deletedThreadId)));
    actions.clearThreadDeltas(event.target, eventProvider, deletedThreadId);
    return true;
  }
  return false;
}
