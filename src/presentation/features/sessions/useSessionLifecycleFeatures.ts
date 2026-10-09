import type { SessionManagementOptions } from "./session-management-types";
import { useSessionDeletion } from "./useSessionDeletion";
import { useSessionRename } from "./useSessionRename";
import { useSessionWorkflows, type SessionWorkflowOptions } from "./useSessionWorkflows";

export type SessionLifecycleFeaturesOptions = {
  state: SessionManagementOptions["state"] & SessionWorkflowOptions["state"];
  setters: SessionManagementOptions["setters"] & SessionWorkflowOptions["setters"];
  actions: SessionManagementOptions["actions"] & SessionWorkflowOptions["actions"];
};

/** Compose session lifecycle UI operations while keeping their individual workflows feature-local. */
export function useSessionLifecycleFeatures({ state, setters, actions }: SessionLifecycleFeaturesOptions) {
  const rename = useSessionRename({
    state: {
      connectedTarget: state.connectedTarget,
      threadProvider: state.threadProvider,
      activeThreadId: state.activeThreadId,
    },
    setters: {
      setThreads: setters.setThreads,
      setSideChats: setters.setSideChats,
      setActiveTitle: setters.setActiveTitle,
      setNotice: setters.setNotice,
    },
    actions: {
      updateCachedThreadTitle: actions.updateCachedThreadTitle,
    },
  });
  const deletion = useSessionDeletion({
    state: {
      connectedTarget: state.connectedTarget,
      threadProvider: state.threadProvider,
      activeThreadId: state.activeThreadId,
      chatRootThreadId: state.chatRootThreadId,
    },
    setters: {
      setThreads: setters.setThreads,
      setSideChats: setters.setSideChats,
      setNotice: setters.setNotice,
    },
    actions: {
      isThreadRunning: actions.isThreadRunning,
      removeThreadCache: actions.removeThreadCache,
      clearActiveThreadAfterDeletion: actions.clearActiveThreadAfterDeletion,
    },
    renameDialog: rename.renameDialog,
    setRenameDialog: rename.setRenameDialog,
  });
  const workflows = useSessionWorkflows({
    state: {
      connectedTarget: state.connectedTarget,
      assistantProvider: state.assistantProvider,
      threadProvider: state.threadProvider,
      activeThreadId: state.activeThreadId,
      chatRootThreadId: state.chatRootThreadId,
      connectedProvider: state.connectedProvider,
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
      updateThreadEntries: actions.updateThreadEntries,
      connect: actions.connect,
    },
  });

  return {
    renameDialog: rename.renameDialog,
    setRenameDialog: rename.setRenameDialog,
    renameSessionName: rename.renameSessionName,
    setRenameSessionName: rename.setRenameSessionName,
    renameSessionError: rename.renameSessionError,
    setRenameSessionError: rename.setRenameSessionError,
    renamingSession: rename.renamingSession,
    openRenameSessionDialog: rename.openRenameSessionDialog,
    saveSessionName: rename.saveSessionName,
    ...deletion,
    ...workflows,
  };
}
