import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteThread, TranscriptEntry } from "../../shared/bridge";
import { providerDisplayName } from "../../shared/provider-display-name";
import { mergeA2ACommunicationSummaries } from "../../shared/a2a-communication-transcript";
import { useTranscriptCache } from "../../shared/transcript-cache-context";
import { type ThreadView } from "../../shared/conversation-view";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

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
    updateThreadEntries(
      target: string,
      provider: AssistantProvider,
      threadId: string,
      update: (current: TranscriptEntry[]) => TranscriptEntry[],
    ): void;
    connect(target: string, provider: AssistantProvider): Promise<boolean>;
  };
};

/** Open provider metadata first, then hydrate and cache long transcripts in the background. */
export function useThreadOpening({ state, setters, actions }: ThreadOpeningOptions) {
  const { bridge } = useDesktopUiRuntime();
  const transcriptCache = useTranscriptCache();
  const [openingThread, setOpeningThread] = useState(false);
  const latestOpenRequest = useRef(0);
  const pendingTranscriptLoads = useRef(new Map<string, Promise<void>>());

  const openThread = async (requestedTarget: string, thread: RemoteThread, sideChatId = ""): Promise<void> => {
    const openRequestId = ++latestOpenRequest.current;
    const isLatestOpenRequest = () => latestOpenRequest.current === openRequestId;
    setOpeningThread(true);
    setters.setNotice(`${providerDisplayName(thread.provider)} 대화 준비 중…`);
    if (thread.provider === state.assistantProvider && state.connectedProvider === thread.provider) {
      actions.cacheActiveThreadView();
    }

    try {
      const [cached, initialCommunicationSummaries] = await Promise.all([
        transcriptCache.readLatest(requestedTarget, thread.provider, thread.id, 20).catch(() => undefined),
        transcriptCache.readCommunicationSummaries(requestedTarget, thread.provider, thread.id).catch(() => []),
      ]);
      if (!isLatestOpenRequest()) return;

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

      if (requestedTarget !== state.connectedTarget || thread.provider !== state.assistantProvider || state.connectedProvider !== thread.provider) {
        const connected = await actions.connect(requestedTarget, thread.provider);
        if (!connected || !isLatestOpenRequest()) return;
      }

      const useCachedTranscript = cached !== undefined && sameUpdatedAt(cached.sourceUpdatedAt, thread.updatedAt);
      let transcriptIncluded = false;
      let result: Awaited<ReturnType<typeof bridge.bridgeRpc.request.openThread>>;
      try {
        result = await bridge.bridgeRpc.request.openThread({
          target: requestedTarget,
          threadId: thread.id,
          provider: thread.provider,
          includeTranscript: false,
        });
      } catch (error) {
        if (!isUnsupportedTranscriptHint(error)) throw error;
        // Older daemon builds do not accept includeTranscript; keep their existing full-open behavior.
        result = await bridge.bridgeRpc.request.openThread({ target: requestedTarget, threadId: thread.id, provider: thread.provider });
        transcriptIncluded = true;
      }
      if (!isLatestOpenRequest()) return;

      if (result.models) {
        setters.setProviderCatalogs((current) => ({
          ...current,
          [thread.provider]: { ...current[thread.provider], models: result.models!, warning: result.modelWarning ?? "" },
        }));
      }
      cachedCommunicationSummaries = [
        ...cachedCommunicationSummaries,
        ...await transcriptCache.readCommunicationSummaries(requestedTarget, thread.provider, thread.id).catch(() => []),
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

      if (transcriptIncluded) await transcriptCache.replaceAll(providerView, thread.updatedAt);
      const [latestCached, latestCommunicationSummaries] = await Promise.all([
        transcriptIncluded
          ? transcriptCache.readLatest(requestedTarget, thread.provider, thread.id, 20).catch(() => undefined)
          : Promise.resolve(cached),
        transcriptCache.readCommunicationSummaries(requestedTarget, thread.provider, thread.id).catch(() => []),
      ]);
      if (!isLatestOpenRequest()) return;

      const latestEntries: TranscriptEntry[] = latestCached
        ? mergeA2ACommunicationSummaries(latestCached.groups.flatMap((group) => group.entries), latestCommunicationSummaries)
        : providerView.entries;
      actions.activateThreadView({ ...providerView, entries: latestEntries }, sideChatId);
      setters.setMobileSidebarOpen(false);

      if (!transcriptIncluded && !useCachedTranscript) {
        startTranscriptLoad(requestedTarget, thread, cachedCommunicationSummaries);
      }
    } catch (error) {
      if (!isLatestOpenRequest()) return;
      const message = errorMessage(error);
      setters.setNotice(/already has an active writer/i.test(message)
        ? `이 세션은 다른 ${providerDisplayName(thread.provider)} 클라이언트에서 사용 중입니다. 기존 클라이언트에서 세션을 닫은 뒤 다시 여세요.`
        : message);
    } finally {
      if (isLatestOpenRequest()) setOpeningThread(false);
    }
  };

  const startTranscriptLoad = (
    target: string,
    thread: RemoteThread,
    knownCommunicationSummaries: Awaited<ReturnType<typeof transcriptCache.readCommunicationSummaries>>,
  ): void => {
    const loadKey = JSON.stringify([target, thread.provider, thread.id]);
    if (pendingTranscriptLoads.current.has(loadKey)) return;

    const load = (async () => {
      try {
        const result = await bridge.bridgeRpc.request.openThread({ target, threadId: thread.id, provider: thread.provider });
        const communicationSummaries = [
          ...knownCommunicationSummaries,
          ...await transcriptCache.readCommunicationSummaries(target, thread.provider, thread.id).catch(() => []),
        ];
        const providerView: ThreadView = {
          target,
          threadId: result.threadId,
          provider: thread.provider,
          title: result.title,
          cwd: result.cwd,
          model: result.model,
          effort: result.reasoningEffort,
          permissionProfile: result.permissionProfile,
          modes: result.modes ?? [],
          currentModeId: result.currentModeId ?? null,
          entries: mergeA2ACommunicationSummaries(result.entries, communicationSummaries),
          skills: result.skills,
          skillWarnings: result.skillWarnings,
        };
        await transcriptCache.replaceAll(providerView, thread.updatedAt);
        actions.updateThreadEntries(target, thread.provider, thread.id, (current) => mergeTranscriptEntries(providerView.entries, current));
      } catch {
        // The metadata view remains usable; a later open can retry the transcript read.
      }
    })().finally(() => pendingTranscriptLoads.current.delete(loadKey));

    pendingTranscriptLoads.current.set(loadKey, load);
  };

  return { openingThread, openThread };
}

function sameUpdatedAt(cached: string | number | null, current: string | number | null): boolean {
  if (cached === null || current === null) return cached === current;
  return String(cached) === String(current);
}

function mergeTranscriptEntries(providerEntries: TranscriptEntry[], currentEntries: TranscriptEntry[]): TranscriptEntry[] {
  const entries = [...providerEntries];
  const positions = new Map(entries.map((entry, index) => [entry.id, index]));
  for (const entry of currentEntries) {
    const index = positions.get(entry.id);
    if (index === undefined) {
      positions.set(entry.id, entries.length);
      entries.push(entry);
    } else {
      entries[index] = entry;
    }
  }
  return entries;
}

function isUnsupportedTranscriptHint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /includeTranscript.*(?:unsupported|not supported)|(?:unsupported|not supported).*includeTranscript/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
