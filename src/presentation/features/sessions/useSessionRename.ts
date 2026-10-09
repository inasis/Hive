import { useState } from "react";
import type { RemoteThread } from "../../shared/bridge";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";
import type { SessionManagementOptions, SessionRenameDialog } from "./session-management-types";

type SessionRenameOptions = {
  state: Pick<SessionManagementOptions["state"], "connectedTarget" | "threadProvider" | "activeThreadId">;
  setters: Pick<SessionManagementOptions["setters"], "setThreads" | "setSideChats" | "setActiveTitle" | "setNotice">;
  actions: Pick<SessionManagementOptions["actions"], "updateCachedThreadTitle">;
};

/** Own session rename state and its provider bridge action. */
export function useSessionRename({ state, setters, actions }: SessionRenameOptions) {
  const { bridge } = useDesktopUiRuntime();
  const [renameDialog, setRenameDialog] = useState<SessionRenameDialog | null>(null);
  const [renameSessionName, setRenameSessionName] = useState("");
  const [renameSessionError, setRenameSessionError] = useState("");
  const [renamingSession, setRenamingSession] = useState(false);

  const openRenameSessionDialog = (thread: Pick<RemoteThread, "id" | "provider" | "title">): void => {
    setRenameDialog({ threadId: thread.id, provider: thread.provider, title: thread.title });
    setRenameSessionName(thread.title);
    setRenameSessionError("");
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
      await bridge.bridgeRpc.request.renameThread({
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
      setters.setSideChats((current) => current.map((chat) =>
        chat.target === state.connectedTarget && chat.provider === renameDialog.provider && chat.threadId === renameDialog.threadId
          ? { ...chat, label: name }
          : chat,
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

  return {
    renameDialog,
    setRenameDialog,
    renameSessionName,
    setRenameSessionName,
    renameSessionError,
    setRenameSessionError,
    renamingSession,
    openRenameSessionDialog,
    saveSessionName,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
