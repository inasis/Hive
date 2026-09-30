import { useState, type Dispatch, type SetStateAction } from "react";
import { assistantProviderSupports } from "../../../../../../src/domain/provider-catalog.js";
import type { AssistantProvider, RemoteThread, TranscriptEntry } from "../../../shared/bridge";
import { bridgeRpc } from "../../bridgeClient";
import { hiveTranscriptCache } from "../../shared/hive-transcript-cache";
import { latestTranscriptEntries } from "../../shared/transcript-groups";
import { upsertProviderThreads } from "../../shared/provider-thread-state";
import type { SideChatTab, ThreadView } from "../../shared/conversation-view";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { WorkspaceTab } from "../../shared/workspace-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ResponseForkOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    activeTitle: string;
    threadProvider: AssistantProvider;
    activeSideChat: SideChatTab | undefined;
    sideChats: SideChatTab[];
    busy: boolean;
    openingThread: boolean;
  };
  refs: { threadViews: ThreadViewStorePort };
  setters: {
    setThreads: StateSetter<RemoteThread[]>;
    setProviderCatalogs: StateSetter<ProviderCatalogs>;
    setSideChats: StateSetter<SideChatTab[]>;
    setActiveTab: StateSetter<WorkspaceTab>;
    setMobileSidebarOpen: StateSetter<boolean>;
    setNotice: StateSetter<string>;
  };
  actions: {
    flushAssistantDeltas(): void;
    cacheActiveThreadView(saveDraft?: boolean): void;
    activateThreadView(view: ThreadView, sideChatId?: string): void;
  };
};

/** Create and open a provider-persisted fork ending at the selected assistant response. */
export function useResponseFork({ state, refs, setters, actions }: ResponseForkOptions) {
  const [forkingEntryId, setForkingEntryId] = useState("");

  const forkCompletedResponse = async (entry: TranscriptEntry): Promise<void> => {
    if (!state.connectedTarget || !state.activeThreadId || entry.role !== "assistant" || entry.status === "inProgress" ||
      state.busy || state.openingThread || forkingEntryId) return;
    const providerMessageId = entry.providerMessageId ?? entry.id;
    actions.flushAssistantDeltas();
    actions.cacheActiveThreadView();
    setForkingEntryId(entry.id);
    setters.setNotice("선택한 AI 응답까지 영구 포크 세션을 만드는 중…");
    let forkedThreadId = "";
    try {
      const forkName = `${state.activeTitle || "대화"} · 포크`.slice(0, 120);
      const forked = await bridgeRpc.request.forkThread({
        target: state.connectedTarget,
        threadId: state.activeThreadId,
        provider: state.threadProvider,
        name: forkName,
        ...(entry.turnId ? { turnId: entry.turnId } : {}),
        ...(providerMessageId ? { messageId: providerMessageId } : {}),
      });
      forkedThreadId = forked.threadId;
      const forkedThread: RemoteThread = {
        ...forked,
        id: forked.threadId,
        provider: state.threadProvider,
        preview: entry.text.slice(0, 240),
      };
      setters.setThreads((current) => upsertProviderThreads(current, [forkedThread], state.threadProvider));
      const opened = await bridgeRpc.request.openThread({
        target: state.connectedTarget,
        threadId: forked.threadId,
        provider: state.threadProvider,
      });
      if (assistantProviderSupports(state.threadProvider, "models") && opened.models) {
        setters.setProviderCatalogs((current) => ({
          ...current,
          [state.threadProvider]: { ...current[state.threadProvider], models: opened.models!, warning: opened.modelWarning ?? "" },
        }));
      }
      const fullView: ThreadView = {
        target: state.connectedTarget,
        threadId: opened.threadId,
        provider: state.threadProvider,
        title: opened.title,
        cwd: opened.cwd,
        model: opened.model,
        effort: opened.reasoningEffort,
        permissionProfile: opened.permissionProfile,
        modes: opened.modes ?? [],
        currentModeId: opened.currentModeId ?? null,
        entries: opened.entries,
        skills: opened.skills,
        skillWarnings: opened.skillWarnings,
      };
      await hiveTranscriptCache.replaceAll(fullView, forked.updatedAt);
      const view: ThreadView = { ...fullView, entries: latestTranscriptEntries(fullView.entries, 20) };
      refs.threadViews.set(view);
      setters.setThreads((current) => upsertProviderThreads(current, [{ ...forkedThread, title: opened.title, cwd: opened.cwd }], state.threadProvider));
      const rootThreadId = state.activeSideChat?.rootThreadId ?? state.activeThreadId;
      const siblingCount = state.sideChats.filter((chat) =>
        chat.target === state.connectedTarget && chat.provider === state.threadProvider && chat.rootThreadId === rootThreadId,
      ).length;
      const forkTab: SideChatTab = {
        target: state.connectedTarget,
        threadId: opened.threadId,
        provider: state.threadProvider,
        parentThreadId: state.activeThreadId,
        rootThreadId,
        label: `포크 ${siblingCount + 1}`,
        persistent: true,
      };
      setters.setSideChats((current) => [...current, forkTab]);
      actions.activateThreadView(view, opened.threadId);
      setters.setActiveTab("chat");
      setters.setMobileSidebarOpen(false);
      setters.setNotice("선택한 AI 응답까지 영구 포크 세션을 만들었습니다.");
    } catch (error) {
      setters.setNotice(forkedThreadId
        ? `포크 세션은 저장됐지만 대화를 열지 못했습니다: ${errorMessage(error)}`
        : errorMessage(error));
    } finally {
      setForkingEntryId("");
    }
  };

  return { forkingEntryId, forkCompletedResponse };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
