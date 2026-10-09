import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../shared/bridge";
import type { SideChatTab } from "../../shared/conversation-view";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SessionRenameDialog = { threadId: string; provider: AssistantProvider; title: string };

export type SessionManagementOptions = {
  state: {
    connectedTarget: string;
    threadProvider: AssistantProvider;
    activeThreadId: string;
    chatRootThreadId: string;
  };
  setters: {
    setThreads: StateSetter<RemoteThread[]>;
    setSideChats: StateSetter<SideChatTab[]>;
    setActiveTitle: StateSetter<string>;
    setNotice: StateSetter<string>;
  };
  actions: {
    isThreadRunning(target: string, provider: AssistantProvider, threadId: string): boolean;
    removeThreadCache(target: string, thread: RemoteThread): void;
    updateCachedThreadTitle(target: string, provider: AssistantProvider, threadId: string, title: string): void;
    clearActiveThreadAfterDeletion(provider: AssistantProvider): void;
  };
};
