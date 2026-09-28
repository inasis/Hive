import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import type { ApprovalUiRequest } from "../../shared/bridge-event-adapter";
import type { ThreadView } from "../conversation/session-state";
import type { ProviderCatalogs } from "../connection/provider-catalog-state";
import { useSessionCreation } from "./useSessionCreation";
import { useThreadOpening } from "./useThreadOpening";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SessionWorkflowOptions = {
  state: {
    connectedTarget: string;
    assistantProvider: AssistantProvider;
    connectedProvider: AssistantProvider;
  };
  platform: { linuxDesktop: boolean; daemonClient: boolean };
  setters: {
    setThreads: StateSetter<RemoteThread[]>;
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
    connect(target: string, provider: AssistantProvider): Promise<boolean>;
  };
};

/** Compose creation and opening workflows for the sessions feature. */
export function useSessionWorkflows({ state, platform, setters, actions }: SessionWorkflowOptions) {
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
      connect: actions.connect,
    },
  });
  const sessionCreation = useSessionCreation({
    state: {
      connectedTarget: state.connectedTarget,
      assistantProvider: state.assistantProvider,
      openingThread: threadOpening.openingThread,
    },
    platform,
    setters: {
      setThreads: setters.setThreads,
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
