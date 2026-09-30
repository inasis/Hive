import { useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import { bridgeRpc } from "../../bridgeClient";
import { providerDisplayName } from "../../shared/provider-display-name";
import { hiveTranscriptCache } from "../../shared/hive-transcript-cache";
import { mergeA2ACommunicationSummaries } from "../../shared/a2a-communication-transcript";
import { type ThreadView } from "../../shared/conversation-view";
import type { TranscriptEntry } from "../../../shared/bridge";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ThreadOpeningOptions = {
  state: {
    connectedTarget: string;
    assistantProvider: AssistantProvider;
    connectedProvider: AssistantProvider;
  };
  setters: {
    setProviderCatalogs: StateSetter<ProviderCatalogs>;
    setNotice: StateSetter<string>;
    setMobileSidebarOpen: StateSetter<boolean>;
  };
  actions: {
    cacheActiveThreadView(): void;
    flushAssistantDeltas(): void;
    activateThreadView(view: ThreadView, sideChatId?: string): void;
    connect(target: string, provider: AssistantProvider): Promise<boolean>;
  };
};

/** Reconnect to the selected provider when needed, hydrate its thread, and activate the view. */
export function useThreadOpening({ state, setters, actions }: ThreadOpeningOptions) {
  const [openingThread, setOpeningThread] = useState(false);

  const openThread = async (requestedTarget: string, thread: RemoteThread, sideChatId = ""): Promise<void> => {
    setOpeningThread(true);
    setters.setNotice(`${providerDisplayName(thread.provider)} 대화 기록을 여는 중…`);
    if (thread.provider === state.assistantProvider && state.connectedProvider === thread.provider) {
      actions.cacheActiveThreadView();
    }
    try {
      const [cached, initialCommunicationSummaries] = await Promise.all([
        hiveTranscriptCache.readLatest(requestedTarget, thread.provider, thread.id, 20).catch(() => undefined),
        hiveTranscriptCache.readCommunicationSummaries(requestedTarget, thread.provider, thread.id).catch(() => []),
      ]);
      let cachedCommunicationSummaries = initialCommunicationSummaries;
      const cachedEntries = mergeA2ACommunicationSummaries(
        cached?.groups.flatMap((group) => group.entries) ?? [],
        cachedCommunicationSummaries,
      );
      if (cached) {
        actions.activateThreadView({
          ...cached.view,
          target: requestedTarget,
          threadId: thread.id,
          provider: thread.provider,
          title: cached.view.title || thread.title,
          cwd: cached.view.cwd || thread.cwd,
          entries: cachedEntries,
        }, sideChatId);
        setters.setMobileSidebarOpen(false);
      }

      if (thread.provider !== state.assistantProvider || state.connectedProvider !== thread.provider) {
        const connected = await actions.connect(requestedTarget, thread.provider);
        if (!connected) return;
      }

      const useCachedTranscript = cached !== undefined && sameUpdatedAt(cached.sourceUpdatedAt, thread.updatedAt);
      const includeTranscript = !useCachedTranscript;
      const openRequest = {
        target: requestedTarget,
        threadId: thread.id,
        provider: thread.provider,
        ...(useCachedTranscript ? { includeTranscript: false } : {}),
      };
      let transcriptIncluded = includeTranscript;
      let result: Awaited<ReturnType<typeof bridgeRpc.request.openThread>>;
      try {
        result = await bridgeRpc.request.openThread(openRequest);
      } catch (error) {
        if (includeTranscript || !isUnsupportedTranscriptHint(error)) throw error;
        transcriptIncluded = true;
        result = await bridgeRpc.request.openThread({ target: requestedTarget, threadId: thread.id, provider: thread.provider });
      }
      if (result.models) {
        setters.setProviderCatalogs((current) => ({
          ...current,
          [thread.provider]: { ...current[thread.provider], models: result.models!, warning: result.modelWarning ?? "" },
        }));
      }
      cachedCommunicationSummaries = [
        ...cachedCommunicationSummaries,
        ...await hiveTranscriptCache.readCommunicationSummaries(requestedTarget, thread.provider, thread.id).catch(() => []),
      ];
      actions.flushAssistantDeltas();
      const restoredEntries = mergeA2ACommunicationSummaries(
        transcriptIncluded ? result.entries : cachedEntries,
        cachedCommunicationSummaries,
      );
      const providerView: ThreadView = {
        target: requestedTarget,
        threadId: result.threadId,
        provider: thread.provider,
        title: result.title,
        cwd: result.cwd,
        model: result.model,
        effort: result.reasoningEffort,
        permissionProfile: result.permissionProfile,
        modes: result.modes ?? [],
        currentModeId: result.currentModeId ?? null,
        entries: restoredEntries,
        skills: result.skills,
        skillWarnings: result.skillWarnings,
      };
      if (transcriptIncluded) await hiveTranscriptCache.replaceAll(providerView, thread.updatedAt);
      cachedCommunicationSummaries = [
        ...cachedCommunicationSummaries,
        ...await hiveTranscriptCache.readCommunicationSummaries(requestedTarget, thread.provider, thread.id).catch(() => []),
      ];
      const cachedLatest = transcriptIncluded
        ? await hiveTranscriptCache.readLatest(requestedTarget, thread.provider, thread.id, 20)
        : cached;
      const latestEntries: TranscriptEntry[] = cachedLatest
        ? mergeA2ACommunicationSummaries(cachedLatest.groups.flatMap((group) => group.entries), cachedCommunicationSummaries)
        : providerView.entries;
      const view: ThreadView = { ...providerView, entries: latestEntries };
      actions.activateThreadView(view, sideChatId);
      setters.setMobileSidebarOpen(false);
    } catch (error) {
      const message = errorMessage(error);
      setters.setNotice(/already has an active writer/i.test(message)
        ? `이 세션은 다른 ${providerDisplayName(thread.provider)} 클라이언트에서 사용 중입니다. 기존 클라이언트에서 세션을 닫은 뒤 다시 여세요.`
        : message);
    } finally {
      setOpeningThread(false);
    }
  };

  return { openingThread, openThread };
}

function sameUpdatedAt(cached: string | number | null, current: string | number | null): boolean {
  return cached !== null && current !== null && String(cached) === String(current);
}

function isUnsupportedTranscriptHint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /includeTranscript.*(?:unsupported|not supported)|(?:unsupported|not supported).*includeTranscript/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
