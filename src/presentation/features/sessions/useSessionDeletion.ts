import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import type { RemoteThread } from "../../shared/bridge";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";
import type { SessionManagementOptions, SessionRenameDialog } from "./session-management-types";

type SessionDeletionOptions = {
  state: SessionManagementOptions["state"];
  setters: Pick<SessionManagementOptions["setters"], "setThreads" | "setSideChats" | "setNotice">;
  actions: Pick<SessionManagementOptions["actions"], "isThreadRunning" | "removeThreadCache" | "clearActiveThreadAfterDeletion">;
  renameDialog: SessionRenameDialog | null;
  setRenameDialog: Dispatch<SetStateAction<SessionRenameDialog | null>>;
};

/** Own session deletion state and provider bridge action. */
export function useSessionDeletion({ state, setters, actions, renameDialog, setRenameDialog }: SessionDeletionOptions) {
  const { bridge } = useDesktopUiRuntime();
  const [deleteDialog, setDeleteDialog] = useState<RemoteThread | null>(null);
  const [deleteSessionError, setDeleteSessionError] = useState("");
  const [deletingSession, setDeletingSession] = useState(false);

  const openDeleteSessionDialog = (thread: RemoteThread): void => {
    setDeleteDialog(thread);
    setDeleteSessionError("");
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
      await bridge.bridgeRpc.request.deleteThread({ target, threadId: thread.id, provider: thread.provider });
      actions.removeThreadCache(target, thread);
      setters.setThreads((current) => current.filter((item) => item.provider !== thread.provider || item.id !== thread.id));
      setters.setSideChats((current) => current.filter((chat) =>
        chat.target !== target || chat.provider !== thread.provider || (chat.threadId !== thread.id && chat.rootThreadId !== thread.id),
      ));
      if (renameDialog?.provider === thread.provider && renameDialog.threadId === thread.id) {
        setRenameDialog(null);
      }
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
    deleteDialog,
    setDeleteDialog,
    deleteSessionError,
    deletingSession,
    deletingThreadIsRunning,
    openDeleteSessionDialog,
    deleteSession,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
