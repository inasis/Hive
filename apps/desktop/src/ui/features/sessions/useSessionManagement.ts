import { useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import { bridgeRpc } from "../../bridgeClient";
import type { SideChatTab } from "../../shared/conversation-view";

type RenameDialog = { threadId: string; provider: AssistantProvider; title: string };
type StateSetter<T> = Dispatch<SetStateAction<T>>;

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

/** Own session rename/delete dialogs and their provider bridge actions. */
export function useSessionManagement({ state, setters, actions }: SessionManagementOptions) {
  const [renameDialog, setRenameDialog] = useState<RenameDialog | null>(null);
  const [renameSessionName, setRenameSessionName] = useState("");
  const [renameSessionError, setRenameSessionError] = useState("");
  const [renamingSession, setRenamingSession] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<RemoteThread | null>(null);
  const [deleteSessionError, setDeleteSessionError] = useState("");
  const [deletingSession, setDeletingSession] = useState(false);

  const openRenameSessionDialog = (thread: RemoteThread): void => {
    setRenameDialog({ threadId: thread.id, provider: thread.provider, title: thread.title });
    setRenameSessionName(thread.title);
    setRenameSessionError("");
  };

  const openDeleteSessionDialog = (thread: RemoteThread): void => {
    setDeleteDialog(thread);
    setDeleteSessionError("");
  };

  const saveSessionName = async (): Promise<void> => {
    if (!renameDialog || renamingSession) return;
    const name = renameSessionName.trim();
    if (!name) {
      setRenameSessionError("세션 이름을 입력하세요.");
      return;
    }
    if (name.length > 120) {
      setRenameSessionError("세션 이름은 120자 이하여야 합니다.");
      return;
    }
    if (name === renameDialog.title) {
      setRenameDialog(null);
      return;
    }
    if (!state.connectedTarget) return;
    setRenamingSession(true);
    setRenameSessionError("");
    try {
      await bridgeRpc.request.renameThread({
        target: state.connectedTarget,
        threadId: renameDialog.threadId,
        name,
        provider: renameDialog.provider,
      });
      setters.setThreads((current) => current.map((thread) =>
        thread.provider === renameDialog.provider && thread.id === renameDialog.threadId
          ? { ...thread, title: name }
          : thread,
      ));
      actions.updateCachedThreadTitle(state.connectedTarget, renameDialog.provider, renameDialog.threadId, name);
      if (state.threadProvider === renameDialog.provider && state.activeThreadId === renameDialog.threadId) {
        setters.setActiveTitle(name);
      }
      setRenameDialog(null);
      setters.setNotice("세션 이름을 변경했습니다.");
    } catch (error) {
      setRenameSessionError(errorMessage(error));
    } finally {
      setRenamingSession(false);
    }
  };

  const deleteSession = async (): Promise<void> => {
    if (!deleteDialog || deletingSession || !state.connectedTarget) return;
    const thread = deleteDialog;
    const target = state.connectedTarget;
    if (actions.isThreadRunning(target, thread.provider, thread.id)) {
      setDeleteSessionError("작업 중인 세션은 먼저 작업을 중지한 뒤 삭제할 수 있습니다.");
      return;
    }
    const deletesActiveThread = state.threadProvider === thread.provider &&
      (state.activeThreadId === thread.id || state.chatRootThreadId === thread.id);
    setDeletingSession(true);
    setDeleteSessionError("");
    try {
      await bridgeRpc.request.deleteThread({ target, threadId: thread.id, provider: thread.provider });
      actions.removeThreadCache(target, thread);
      setters.setThreads((current) => current.filter((item) => item.provider !== thread.provider || item.id !== thread.id));
      setters.setSideChats((current) => current.filter((chat) =>
        chat.target !== target || chat.provider !== thread.provider || (chat.threadId !== thread.id && chat.rootThreadId !== thread.id),
      ));
      if (renameDialog?.provider === thread.provider && renameDialog.threadId === thread.id) setRenameDialog(null);
      if (deletesActiveThread) actions.clearActiveThreadAfterDeletion(thread.provider);
      setDeleteDialog(null);
      setters.setNotice(`“${thread.title}” 세션을 삭제했습니다.`);
    } catch (error) {
      setDeleteSessionError(errorMessage(error));
    } finally {
      setDeletingSession(false);
    }
  };

  const deletingThreadIsRunning = Boolean(deleteDialog &&
    actions.isThreadRunning(state.connectedTarget, deleteDialog.provider, deleteDialog.id));

  return {
    renameDialog,
    setRenameDialog,
    renameSessionName,
    setRenameSessionName,
    renameSessionError,
    setRenameSessionError,
    renamingSession,
    deleteDialog,
    setDeleteDialog,
    deleteSessionError,
    deletingSession,
    deletingThreadIsRunning,
    openRenameSessionDialog,
    openDeleteSessionDialog,
    saveSessionName,
    deleteSession,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
