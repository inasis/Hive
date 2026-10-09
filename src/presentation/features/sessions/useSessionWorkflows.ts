import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../shared/bridge";
import type { ApprovalUiRequest } from "../../shared/bridge-events";
import type { SideChatTab, ThreadView } from "../../shared/conversation-view";
import type { TranscriptEntry } from "../../shared/bridge";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { useSessionCreation } from "./useSessionCreation";
import { useThreadOpening } from "./useThreadOpening";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SessionWorkflowOptions = {
  state: {
    connectedTarget: string;
    assistantProvider: AssistantProvider;
    threadProvider: AssistantProvider;
    activeThreadId: string;
    chatRootThreadId: string;
    connectedProvider: AssistantProvider;
  };
  setters: {
    setThreads: StateSetter<RemoteThread[]>;
    setSideChats: StateSetter<SideChatTab[]>;
    setProviderCatalogs: StateSetter<ProviderCatalogs>;
    setNotice: StateSetter<string>;
    setDraft: StateSetter<string>;
    setMobileSidebarOpen: StateSetter<boolean>;
    setBusy: StateSetter<boolean>;
    setBusySince: StateSetter<number | null>;
    setApproval: StateSetter<ApprovalUiRequest | null>;
  };
  actions: {
    cacheActiveThreadView(): void;
    flushAssistantDeltas(): void;
    activateThreadView(view: ThreadView, sideChatId?: string): void;
    updateThreadEntries(
      target: string,
      provider: AssistantProvider,
      threadId: string,
      update: (current: TranscriptEntry[]) => TranscriptEntry[],
    ): void;
    connect(target: string, provider: AssistantProvider): Promise<boolean>;
  };
};

/** Compose creation and opening workflows for the sessions feature. */
export function useSessionWorkflows({ state, setters, actions }: SessionWorkflowOptions) {
  const threadOpening = useThreadOpening({
    state: {
      connectedTarget: state.connectedTarget,
      assistantProvider: state.assistantProvider,
      connectedProvider: state.connectedProvider,
    },
    setters: {
      setProviderCatalogs: setters.setProviderCatalogs,
      setNotice: setters.setNotice,
      setMobileSidebarOpen: setters.setMobileSidebarOpen,
    },
    actions: {
      cacheActiveThreadView: actions.cacheActiveThreadView,
      flushAssistantDeltas: actions.flushAssistantDeltas,
      activateThreadView: actions.activateThreadView,
      updateThreadEntries: actions.updateThreadEntries,
      connect: actions.connect,
    },
  });
  const sessionCreation = useSessionCreation({
    state: {
      connectedTarget: state.connectedTarget,
      assistantProvider: state.assistantProvider,
      threadProvider: state.threadProvider,
      activeThreadId: state.activeThreadId,
      chatRootThreadId: state.chatRootThreadId,
      openingThread: threadOpening.openingThread,
    },
    setters: {
      setThreads: setters.setThreads,
      setSideChats: setters.setSideChats,
      setProviderCatalogs: setters.setProviderCatalogs,
      setNotice: setters.setNotice,
      setDraft: setters.setDraft,
      setMobileSidebarOpen: setters.setMobileSidebarOpen,
      setBusy: setters.setBusy,
      setBusySince: setters.setBusySince,
      setApproval: setters.setApproval,
    },
    actions: {
      cacheActiveThreadView: actions.cacheActiveThreadView,
      flushAssistantDeltas: actions.flushAssistantDeltas,
      activateThreadView: actions.activateThreadView,
    },
  });
  return { ...sessionCreation, ...threadOpening };
}
