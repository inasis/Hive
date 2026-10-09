import { useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../shared/bridge";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import { providerDisplayName } from "../../shared/provider-display-name";
import type { ApprovalUiRequest } from "../../shared/bridge-events";
import { upsertProviderThreads } from "../../shared/provider-thread-state";
import type { SideChatTab, ThreadView } from "../../shared/conversation-view";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SessionCreationOptions = {
  state: {
    connectedTarget: string;
    assistantProvider: AssistantProvider;
    threadProvider: AssistantProvider;
    activeThreadId: string;
    chatRootThreadId: string;
    openingThread: boolean;
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
  };
};

export type CreateSessionInput = {
  cwd: string;
  name: string;
  permissionPresets: string[];
};

export type CreateSessionResult =
  | { kind: "ignored" }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "created" };

/** Own provider session creation and activation after the dialog submits its form. */
export function useSessionCreation({ state, setters, actions }: SessionCreationOptions) {
  const { bridge } = useDesktopUiRuntime();
  const [creatingSession, setCreatingSession] = useState(false);
  const createSessionInWorkspace = async ({ cwd, name, permissionPresets }: CreateSessionInput): Promise<CreateSessionResult> => {
    const workspacePath = cwd.trim();
    const sessionName = name.trim();
    if (!state.connectedTarget || !workspacePath || creatingSession || state.openingThread) return { kind: "ignored" };
    if (sessionName.length > 120) {
      return { kind: "invalid", message: "세션 이름은 120자 이하여야 합니다." };
    }

    actions.cacheActiveThreadView();
    setCreatingSession(true);
    setters.setNotice(`작업 공간에서 새 ${providerDisplayName(state.assistantProvider)} 세션을 만드는 중…`);
    try {
      const provider = state.assistantProvider;
      const createRequest = { target: state.connectedTarget, cwd: workspacePath, provider };
      const result = await (() => {
        if (sessionName && assistantProviderSupports(provider, "createNamedSessions")) {
          if (permissionPresets.length && assistantProviderSupports(provider, "permissionProfileCreation")) {
            return bridge.bridgeRpc.request.createThread({ ...createRequest, provider, name: sessionName, permissionPresets });
          }
          return bridge.bridgeRpc.request.createThread({ ...createRequest, provider, name: sessionName });
        }
        if (permissionPresets.length && assistantProviderSupports(provider, "permissionProfileCreation")) {
          return bridge.bridgeRpc.request.createThread({ ...createRequest, provider, permissionPresets });
        }
        return bridge.bridgeRpc.request.createThread(createRequest);
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
          await bridge.bridgeRpc.request.renameThread({ target: state.connectedTarget, threadId: result.threadId, name: sessionName, provider });
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
      const canKeepAsWorkspaceTab = provider === state.threadProvider && Boolean(state.activeThreadId && state.chatRootThreadId);
      if (canKeepAsWorkspaceTab) {
        const sessionTab: SideChatTab = {
          target: state.connectedTarget,
          threadId: result.threadId,
          provider,
          parentThreadId: state.activeThreadId,
          rootThreadId: state.chatRootThreadId,
          label: title || `${providerDisplayName(provider)} 세션`,
          persistent: true,
          kind: "session",
        };
        setters.setSideChats((current) => current.some((tab) =>
          tab.target === sessionTab.target && tab.provider === sessionTab.provider && tab.threadId === sessionTab.threadId,
        ) ? current : [...current, sessionTab]);
        actions.activateThreadView(view, result.threadId);
      } else {
        actions.activateThreadView(view);
      }
      setters.setDraft("");
      setters.setMobileSidebarOpen(false);
      setters.setBusy(false);
      setters.setBusySince(null);
      setters.setNotice(renameWarning || "새 세션을 만들었습니다. 첫 메시지를 입력하세요.");
      return { kind: "created" };
    } catch (error) {
      const message = errorMessage(error);
      setters.setNotice(message);
      return { kind: "failed", message };
    } finally {
      setCreatingSession(false);
    }
  };

  return {
    creatingSession,
    createSessionInWorkspace,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
