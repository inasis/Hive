import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AssistantProvider, RemoteCommand, RemoteThread, TranscriptEntry } from "../../../shared/bridge";
import { providerDisplayName } from "../../shared/provider-display-name";
import type { ApprovalUiRequest, UiBridgeEvent } from "../../shared/bridge-event-adapter";
import { upsertA2ACommunicationEntry } from "../../shared/a2a-communication-transcript";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { replaceWebSearchEntries, upsertEntry } from "./transcript-state";
import type { SideChatTab } from "../../shared/conversation-view";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { TranscriptDelta } from "./useTranscriptDeltaBuffer";
import type { ConversationRuntimePort } from "../../shared/conversation-store";
import { hiveTranscriptCache } from "../../shared/hive-transcript-cache";
import { upsertProviderThreads } from "../../shared/provider-thread-state";

type ThreadEntryUpdate = (current: TranscriptEntry[]) => TranscriptEntry[];

export type BridgeEventSetters = {
  setNotice: Dispatch<SetStateAction<string>>;
  setThreads: Dispatch<SetStateAction<RemoteThread[]>>;
  setProviderCatalogs: Dispatch<SetStateAction<ProviderCatalogs>>;
  setApproval: Dispatch<SetStateAction<ApprovalUiRequest | null>>;
  setActiveTitle: Dispatch<SetStateAction<string>>;
  setSideChats: Dispatch<SetStateAction<SideChatTab[]>>;
  setCurrentModel: Dispatch<SetStateAction<string>>;
  setCurrentEffort: Dispatch<SetStateAction<string | null>>;
  setCurrentPermissionProfile: Dispatch<SetStateAction<string | null>>;
  setCurrentModeId: Dispatch<SetStateAction<string | null>>;
  setSlashCommands: Dispatch<SetStateAction<RemoteCommand[]>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setBusySince: Dispatch<SetStateAction<number | null>>;
  setActiveTurnId: Dispatch<SetStateAction<string>>;
  setStoppingTurn: Dispatch<SetStateAction<boolean>>;
  setSteeringPrompt: Dispatch<SetStateAction<boolean>>;
};

export type BridgeEventHandlerDependencies = {
  context: {
    connectedTarget: string;
  };
  setters: BridgeEventSetters;
  refs: {
    threadViews: MutableRefObject<ThreadViewStorePort>;
    runtime: ConversationRuntimePort;
  };
  actions: {
    updateThreadEntries: (target: string, provider: AssistantProvider, threadId: string, update: ThreadEntryUpdate) => void;
    flushAssistantDeltas: () => void;
    enqueueAssistantDelta: (delta: TranscriptDelta) => void;
    clearThreadDeltas: (target: string, provider: AssistantProvider, threadId: string) => void;
  };
};

export function applyConversationBridgeEvent(event: UiBridgeEvent, dependencies: BridgeEventHandlerDependencies): void {
  const { context, setters, refs, actions } = dependencies;
  if (!("target" in event) || event.target !== context.connectedTarget) return;
  const eventProvider = event.provider ?? refs.runtime.activeProvider();
  const isActiveThread = refs.runtime.isThreadSelected(event.target, eventProvider, event.threadId);

  if (event.type === "approvalRequested") {
    setters.setApproval({ ...event.approval, requestId: event.requestId, provider: eventProvider });
    return;
  }
  if (event.type === "threadCreated") {
    setters.setThreads((current) => upsertProviderThreads(current, [{
      id: event.threadId,
      provider: eventProvider,
      title: event.title,
      cwd: event.cwd,
      preview: event.preview,
      updatedAt: event.updatedAt,
    }], eventProvider));
    return;
  }
  if (event.type === "threadRenamed") {
    setters.setThreads((current) => current.map((thread) => thread.provider === eventProvider && thread.id === event.threadId ? { ...thread, title: event.title } : thread));
    refs.threadViews.current.update(event.target, eventProvider, event.threadId, (view) => ({ ...view, title: event.title }));
    if (isActiveThread) setters.setActiveTitle(event.title);
    return;
  }
  if (event.type === "threadDeleted") {
    const deletedThreadId = event.threadId;
    refs.threadViews.current.delete(event.target, eventProvider, deletedThreadId);
    void hiveTranscriptCache.delete(event.target, eventProvider, deletedThreadId);
    refs.runtime.clearThread(event.target, eventProvider, deletedThreadId);
    setters.setThreads((current) => current.filter((thread) => thread.provider !== eventProvider || thread.id !== deletedThreadId));
    setters.setSideChats((current) => current.filter((chat) => chat.target !== event.target || chat.provider !== eventProvider || (chat.threadId !== deletedThreadId && chat.rootThreadId !== deletedThreadId)));
    actions.clearThreadDeltas(event.target, eventProvider, deletedThreadId);
    return;
  }
  if (event.type === "transcriptCleared") {
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, () => []);
    void hiveTranscriptCache.clearCommunicationSummaries(event.target, eventProvider, event.threadId);
    return;
  }
  if (event.type === "turnStarted") {
    const startedAt = refs.runtime.runningSince(event.target, eventProvider, event.threadId) ?? Date.now();
    refs.runtime.startThread(event.target, eventProvider, event.threadId, startedAt);
    refs.runtime.observeTurnStart(event.target, eventProvider, event.threadId);
    if (event.turnId) {
      refs.runtime.setTurnId(event.target, eventProvider, event.threadId, event.turnId);
      if (isActiveThread) setters.setActiveTurnId(event.turnId);
    }
    if (isActiveThread) {
      setters.setBusy(true);
      setters.setBusySince((current) => current ?? startedAt);
    }
    return;
  }
  if (event.type === "turnCompleted") {
    const startedAt = refs.runtime.runningSince(event.target, eventProvider, event.threadId);
    const responseDurationMs = startedAt === null ? undefined : Math.max(1_000, Date.now() - startedAt);
    const userInterrupted = refs.runtime.completeTurn(event.target, eventProvider, event.threadId);
    actions.flushAssistantDeltas();
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, (current) => current.map((entry) =>
      entry.role === "assistant" && (event.turnId ? entry.turnId === event.turnId : entry.status === "inProgress" || entry.responseCompleted === false)
        ? {
            ...entry,
            status: event.error ? "failed" : "completed",
            responseCompleted: true,
            ...(responseDurationMs === undefined ? {} : { responseDurationMs }),
          }
        : entry,
    ));
    if (!isActiveThread) return;
    setters.setBusy(false);
    setters.setActiveTurnId("");
    setters.setStoppingTurn(false);
    setters.setSteeringPrompt(false);
    setters.setBusySince(null);
    if (!userInterrupted && event.error) setters.setNotice(`${providerDisplayName(eventProvider)} 오류: ${event.error}`);
    return;
  }

  if (event.provider && event.provider !== refs.runtime.activeProvider()) return;
  if (event.type === "threadSettingsUpdated") {
    const settings = event.settings;
    const view = refs.threadViews.current.get(event.target, eventProvider, event.threadId);
    if (view) {
      const model = settings.model ?? view.model;
      const permissionProfile = settings.permissionProfile ?? view.permissionProfile;
      const currentModeId = settings.modeId ?? view.currentModeId;
      refs.threadViews.current.update(event.target, eventProvider, event.threadId, (current) => ({
        ...current,
        model,
        effort: settings.effort,
        permissionProfile,
        currentModeId,
      }));
      if (isActiveThread) {
        setters.setCurrentModel(model);
        setters.setCurrentEffort(settings.effort);
        setters.setCurrentPermissionProfile(permissionProfile);
        setters.setCurrentModeId(currentModeId);
      }
    }
    if (settings.supportedReasoningEfforts) {
      setters.setProviderCatalogs((current) => {
        const catalog = current[eventProvider];
        if (!catalog) return current;
        const selectedModel = settings.model ?? view?.model;
        if (!selectedModel) return current;
        return {
          ...current,
          [eventProvider]: {
            ...catalog,
            models: catalog.models.map((model) => model.model === selectedModel
              ? { ...model, supportedReasoningEfforts: settings.supportedReasoningEfforts! }
              : model),
          },
        };
      });
    }
    return;
  }
  if (event.type === "commandsUpdated") {
    const incoming: RemoteCommand[] = event.commands.map((command) => ({
      ...command,
      provider: command.provider ?? providerDisplayName(eventProvider),
    }));
    if (isActiveThread) setters.setSlashCommands(incoming);
    return;
  }
  if (event.type === "assistantDelta") {
    actions.enqueueAssistantDelta({
      target: event.target,
      provider: eventProvider,
      threadId: event.threadId,
      turnId: event.turnId,
      providerMessageId: event.messageId,
      text: event.text,
    });
    return;
  }
  if (event.type === "transcriptEntriesUpdated") {
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, (current) => event.replaceIdPrefix
      ? replaceWebSearchEntries(current, event.replaceIdPrefix, event.entries)
      : event.entries.reduce(upsertEntry, current));
    return;
  }
  if (event.type === "a2aCommunicationSummary") {
    const responseTurnId = event.responseTurnId;
    if (responseTurnId) actions.flushAssistantDeltas();
    void hiveTranscriptCache.saveCommunicationSummary(event.target, eventProvider, event.threadId, event.summaryId, event.communications, responseTurnId);
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, (current) => {
      return upsertA2ACommunicationEntry(current, event.communications, responseTurnId);
    });
    return;
  }
  if (event.type === "assistantMessageCompleted") {
    actions.flushAssistantDeltas();
    actions.updateThreadEntries(event.target, eventProvider, event.threadId, (current) => {
      const messageId = `${event.turnId}:${event.messageId}`;
      const streamedText = current.find((entry) => entry.id === messageId)?.text ?? "";
      return upsertEntry(current, {
        id: messageId,
        role: "assistant",
        text: streamedText.length > event.text.length ? streamedText : event.text,
        turnId: event.turnId,
        providerMessageId: event.messageId,
        responseCompleted: false,
        status: "completed",
      });
    });
    return;
  }
  if (event.type === "warning" && isActiveThread) {
    setters.setNotice(`${providerDisplayName(eventProvider)} 알림: ${event.message}`);
  }
}
