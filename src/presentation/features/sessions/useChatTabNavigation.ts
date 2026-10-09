import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../shared/bridge";
import type { SideChatTab, ThreadView } from "../../shared/conversation-view";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { WorkspaceTab } from "../../shared/workspace-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ChatTabNavigationOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    threadProvider: AssistantProvider;
    activeTab: WorkspaceTab;
    threads: RemoteThread[];
  };
  refs: { threadViews: ThreadViewStorePort };
  setters: {
    setSideChats: StateSetter<SideChatTab[]>;
    setActiveSideChatId: StateSetter<string>;
    setActiveTab: StateSetter<WorkspaceTab>;
  };
  actions: {
    flushAssistantDeltas(): void;
    cacheActiveThreadView(saveDraft?: boolean): void;
    activateThreadView(view: ThreadView, sideChatId?: string): void;
    openThread(target: string, thread: RemoteThread, sideChatId?: string): Promise<void>;
  };
};

/** Switch and close chat tabs without owning fork creation or provider session lifecycle. */
export function useChatTabNavigation({ state, refs, setters, actions }: ChatTabNavigationOptions) {
  const switchChatTab = (threadId: string, sideChatId = ""): void => {
    if (threadId === state.activeThreadId) {
      setters.setActiveSideChatId(sideChatId);
      setters.setActiveTab("chat");
      return;
    }
    actions.flushAssistantDeltas();
    actions.cacheActiveThreadView();
    const view = refs.threadViews.get(state.connectedTarget, state.threadProvider, threadId);
    if (view) {
      actions.activateThreadView(view, sideChatId);
      return;
    }
    const thread = state.threads.find((item) => item.provider === state.threadProvider && item.id === threadId);
    if (thread) void actions.openThread(state.connectedTarget, thread, sideChatId);
  };

  const closeSideChat = (chat: SideChatTab): void => {
    const wasSelected = state.threadProvider === chat.provider && state.activeThreadId === chat.threadId;
    const contentTab = state.activeTab;
    setters.setSideChats((current) => current.filter((item) =>
      item.target !== chat.target || item.provider !== chat.provider || item.threadId !== chat.threadId,
    ));
    if (!wasSelected) return;
    switchChatTab(chat.rootThreadId);
    if (contentTab !== "chat") setters.setActiveTab(contentTab);
  };

  return { switchChatTab, closeSideChat };
}
