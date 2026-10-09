import { useState, type Dispatch, type SetStateAction } from "react";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import type { AssistantProvider, TranscriptEntry } from "../../shared/bridge";
import type { SideChatTab, ThreadView } from "../../shared/conversation-view";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { ConversationRuntimePort } from "../../shared/conversation-store";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";
import { startSideChatPrompt } from "./start-side-chat-prompt";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SideChatCreationOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    threadProvider: AssistantProvider;
    activeSideChat: SideChatTab | undefined;
    sideChats: SideChatTab[];
    openingThread: boolean;
  };
  refs: {
    threadViews: ThreadViewStorePort;
    runtime: ConversationRuntimePort;
  };
  setters: {
    setProviderCatalogs: StateSetter<ProviderCatalogs>;
    setSideChats: StateSetter<SideChatTab[]>;
    setDraft: StateSetter<string>;
    setBusy: StateSetter<boolean>;
    setActiveTurnId: StateSetter<string>;
    setStoppingTurn: StateSetter<boolean>;
    setBusySince: StateSetter<number | null>;
    setNotice: StateSetter<string>;
  };
  actions: {
    flushAssistantDeltas(): void;
    cacheActiveThreadView(saveDraft?: boolean): void;
    activateThreadView(view: ThreadView, sideChatId?: string): void;
    updateThreadEntries(target: string, provider: AssistantProvider, threadId: string, update: (current: TranscriptEntry[]) => TranscriptEntry[]): void;
  };
};

/** Create a provider-backed or temporary side conversation and optionally start its first turn. */
export function useSideChatCreation({ state, refs, setters, actions }: SideChatCreationOptions) {
  const { bridge, promptRecovery } = useDesktopUiRuntime();
  const [creatingSideChat, setCreatingSideChat] = useState(false);

  const createSideChat = async (initialPrompt = ""): Promise<void> => {
    if (!state.connectedTarget || !state.activeThreadId || state.openingThread || creatingSideChat) return;
    actions.flushAssistantDeltas();
    actions.cacheActiveThreadView(!initialPrompt.trim());
    const rootThreadId = state.activeSideChat?.rootThreadId ?? state.activeThreadId;
    const sourceThreadId = rootThreadId;
    const sourceView = refs.threadViews.get(state.connectedTarget, state.threadProvider, sourceThreadId);
    if (!sourceView) {
      setters.setNotice("현재 대화 기록을 보관하지 못했습니다. 세션을 다시 연 뒤 시도하세요.");
      return;
    }
    const persistentSideChat = assistantProviderSupports(state.threadProvider, "persistentSideChats");
    setCreatingSideChat(true);
    setters.setNotice(persistentSideChat
      ? "원본 대화의 마지막 응답을 기반으로 새 세션을 만드는 중…"
      : "원본 대화 맥락에서 임시 사이드 대화를 여는 중…");
    try {
      const result = await bridge.bridgeRpc.request.forkSideThread({
        target: state.connectedTarget,
        threadId: sourceThreadId,
        provider: state.threadProvider,
      });
      if (assistantProviderSupports(state.threadProvider, "models") && result.models) {
        setters.setProviderCatalogs((current) => ({
          ...current,
          [state.threadProvider]: { ...current[state.threadProvider], models: result.models!, warning: result.modelWarning ?? "" },
        }));
      }
      const siblingCount = state.sideChats.filter((chat) =>
        chat.target === state.connectedTarget && chat.provider === state.threadProvider && chat.rootThreadId === rootThreadId,
      ).length;
      const view: ThreadView = {
        target: state.connectedTarget,
        threadId: result.threadId,
        provider: state.threadProvider,
        title: result.title,
        cwd: result.cwd,
        model: result.model,
        effort: result.reasoningEffort,
        permissionProfile: result.permissionProfile,
        modes: result.modes ?? [],
        currentModeId: result.currentModeId ?? null,
        entries: [...sourceView.entries],
        skills: result.skills,
        skillWarnings: result.skillWarnings,
      };
      const sideTab: SideChatTab = {
        target: state.connectedTarget,
        threadId: result.threadId,
        provider: state.threadProvider,
        parentThreadId: sourceThreadId,
        rootThreadId,
        label: persistentSideChat ? result.title || `포크 ${siblingCount + 1}` : `사이드 ${siblingCount + 1}`,
        kind: persistentSideChat ? "fork" : "temporary",
        ...(persistentSideChat ? { persistent: true } : {}),
      };
      refs.threadViews.set(view);
      setters.setSideChats((current) => [...current, sideTab]);
      actions.activateThreadView(view, result.threadId);
      setters.setDraft("");

      if (initialPrompt.trim()) {
        await startSideChatPrompt({
          target: state.connectedTarget,
          provider: state.threadProvider,
          threadId: result.threadId,
          text: initialPrompt.trim(),
          runtime: refs.runtime,
          promptRecovery,
          setters,
          updateThreadEntries: actions.updateThreadEntries,
        });
      } else {
        setters.setNotice(persistentSideChat
          ? "원본 응답을 기반으로 저장되는 새 세션을 열었습니다."
          : "원본 맥락을 이어받은 독립 사이드 대화를 열었습니다.");
      }
    } catch (error) {
      setters.setNotice(errorMessage(error));
    } finally {
      setCreatingSideChat(false);
    }
  };

  return { creatingSideChat, createSideChat };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
