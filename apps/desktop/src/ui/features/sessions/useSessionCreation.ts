import { useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import { assistantProviderSupports } from "../../../../../../src/domain/provider-catalog.js";
import { bridgeRpc } from "../../bridgeClient";
import { providerDisplayName } from "../../shared/provider-display-name";
import type { ApprovalUiRequest } from "../../shared/bridge-event-adapter";
import { upsertProviderThreads } from "../../shared/provider-thread-state";
import type { ThreadView } from "../../shared/conversation-view";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SessionCreationOptions = {
  state: {
    connectedTarget: string;
    assistantProvider: AssistantProvider;
    openingThread: boolean;
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
  };
};

/** Own new-session dialog state, folder selection, and provider session creation. */
export function useSessionCreation({ state, platform, setters, actions }: SessionCreationOptions) {
  const [creatingSession, setCreatingSession] = useState(false);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [newSessionDialogMode, setNewSessionDialogMode] = useState<"workspace" | "session">("workspace");
  const [newSessionPath, setNewSessionPath] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [newPermissionPresets, setNewPermissionPresets] = useState<string[]>([]);
  const [newSessionError, setNewSessionError] = useState("");
  const [choosingWorkspaceFolder, setChoosingWorkspaceFolder] = useState(false);

  const openNewSessionDialog = (mode: "workspace" | "session" = "workspace", initialPath = "") => {
    setNewSessionDialogMode(mode);
    setNewSessionPath(initialPath);
    setNewSessionName("");
    setNewPermissionPresets([]);
    setNewSessionError("");
    setNewSessionDialogOpen(true);
  };

  const changeNewSessionPath = (path: string) => {
    setNewSessionPath(path);
    setNewSessionError("");
  };

  const changeNewSessionName = (name: string) => {
    setNewSessionName(name);
    setNewSessionError("");
  };

  const chooseWorkspaceFolder = async () => {
    if (!platform.linuxDesktop || !platform.daemonClient || choosingWorkspaceFolder) return;
    setChoosingWorkspaceFolder(true);
    setNewSessionError("");
    try {
      const result = await bridgeRpc.request.chooseWorkspaceFolder({
        ...(newSessionPath ? { startingFolder: newSessionPath } : {}),
      });
      if (result.path) setNewSessionPath(result.path);
    } catch (error) {
      setNewSessionError(errorMessage(error));
    } finally {
      setChoosingWorkspaceFolder(false);
    }
  };

  const createSessionInWorkspace = async (cwd: string, requestedName = ""): Promise<void> => {
    const workspacePath = cwd.trim();
    const sessionName = requestedName.trim();
    if (!state.connectedTarget || !workspacePath || creatingSession || state.openingThread) return;
    if (sessionName.length > 120) {
      setNewSessionError("세션 이름은 120자 이하여야 합니다.");
      return;
    }

    actions.cacheActiveThreadView();
    setCreatingSession(true);
    setters.setNotice(`작업 공간에서 새 ${providerDisplayName(state.assistantProvider)} 세션을 만드는 중…`);
    try {
      const provider = state.assistantProvider;
      const createRequest = { target: state.connectedTarget, cwd: workspacePath, provider };
      const result = await (() => {
        if (sessionName && assistantProviderSupports(provider, "createNamedSessions")) {
          if (newPermissionPresets.length && assistantProviderSupports(provider, "permissionProfileCreation")) {
            return bridgeRpc.request.createThread({ ...createRequest, provider, name: sessionName, permissionPresets: newPermissionPresets });
          }
          return bridgeRpc.request.createThread({ ...createRequest, provider, name: sessionName });
        }
        if (newPermissionPresets.length && assistantProviderSupports(provider, "permissionProfileCreation")) {
          return bridgeRpc.request.createThread({ ...createRequest, provider, permissionPresets: newPermissionPresets });
        }
        return bridgeRpc.request.createThread(createRequest);
      })();
      if (result.models) {
        setters.setProviderCatalogs((current) => ({
          ...current,
          [provider]: { ...current[provider], models: result.models!, warning: result.modelWarning ?? "" },
        }));
      }

      let title = result.title;
      let renameWarning = "";
      if (sessionName && !assistantProviderSupports(provider, "createNamedSessions")) {
        try {
          await bridgeRpc.request.renameThread({ target: state.connectedTarget, threadId: result.threadId, name: sessionName, provider });
          title = sessionName;
        } catch (error) {
          renameWarning = `세션은 만들었지만 이름을 지정하지 못했습니다: ${errorMessage(error)}`;
        }
      }

      actions.flushAssistantDeltas();
      setters.setThreads((current) => upsertProviderThreads(current, [{ ...result.thread, provider, title }], provider));
      const view: ThreadView = {
        target: state.connectedTarget,
        threadId: result.threadId,
        provider,
        title,
        cwd: result.cwd,
        model: result.model,
        effort: result.reasoningEffort,
        permissionProfile: result.permissionProfile,
        modes: result.modes ?? [],
        currentModeId: result.currentModeId ?? null,
        entries: result.entries,
        skills: result.skills,
        skillWarnings: result.skillWarnings,
      };
      actions.activateThreadView(view);
      setters.setDraft("");
      setters.setMobileSidebarOpen(false);
      setters.setBusy(false);
      setters.setBusySince(null);
      setters.setApproval(null);
      setNewSessionDialogOpen(false);
      setNewSessionName("");
      setNewSessionError("");
      setters.setNotice(renameWarning || "새 세션을 만들었습니다. 첫 메시지를 입력하세요.");
    } catch (error) {
      const message = errorMessage(error);
      setNewSessionError(message);
      setters.setNotice(message);
    } finally {
      setCreatingSession(false);
    }
  };

  return {
    creatingSession,
    newSessionDialog: {
      open: newSessionDialogOpen,
      mode: newSessionDialogMode,
      path: newSessionPath,
      name: newSessionName,
      permissionPresets: newPermissionPresets,
      error: newSessionError,
      choosingWorkspaceFolder,
    },
    openNewSessionDialog,
    closeNewSessionDialog: () => setNewSessionDialogOpen(false),
    changeNewSessionPath,
    changeNewSessionName,
    setNewPermissionPresets,
    chooseWorkspaceFolder,
    createSessionInWorkspace,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
