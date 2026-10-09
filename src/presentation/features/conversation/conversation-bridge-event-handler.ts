import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AssistantProvider, RemoteCommand, RemoteThread, TranscriptEntry } from "../../shared/bridge";
import { providerDisplayName } from "../../shared/provider-display-name";
import type { ApprovalUiRequest, UiBridgeEvent } from "../../shared/bridge-events";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import type { SideChatTab } from "../../shared/conversation-view";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { TranscriptDelta } from "./useTranscriptDeltaBuffer";
import type { ConversationRuntimePort } from "../../shared/conversation-store";
import type { TranscriptCachePort } from "../../../application/ports/transcript-cache.js";
import { applyThreadLifecycleBridgeEvent } from "./conversation-thread-lifecycle-handler";
import { applyThreadSettingsEvent } from "./conversation-thread-settings-event-handler";
import { applyTranscriptClearedEvent, applyTranscriptContentEvent } from "./conversation-transcript-event-handler";
import { applyTurnLifecycleEvent } from "./conversation-turn-lifecycle-handler";

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
    transcriptCache: TranscriptCachePort;
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
  if (event.type.startsWith("transport")) return;
  const currentTarget = event.target === context.connectedTarget;
  if (!currentTarget && !event.target.startsWith("daemon:")) return;
  const eventProvider = event.provider ?? refs.runtime.activeProvider();
  const isActiveThread = refs.runtime.isThreadSelected(event.target, eventProvider, event.threadId);

  if (applyThreadLifecycleBridgeEvent(event, {
    eventProvider,
    currentTarget,
    isActiveThread,
    setters: {
      setThreads: setters.setThreads,
      setActiveTitle: setters.setActiveTitle,
      setSideChats: setters.setSideChats,
    },
    refs: {
      threadViews: refs.threadViews,
      runtime: refs.runtime,
      transcriptCache: refs.transcriptCache,
    },
    actions: { clearThreadDeltas: actions.clearThreadDeltas },
  })) return;

  const transcriptDependencies = {
    eventProvider,
    transcriptCache: refs.transcriptCache,
    actions: {
      updateThreadEntries: actions.updateThreadEntries,
      flushAssistantDeltas: actions.flushAssistantDeltas,
    },
  };
  if (applyTranscriptClearedEvent(event, transcriptDependencies)) return;

  if (event.type === "approvalRequested") {
    setters.setApproval({ ...event.approval, requestId: event.requestId, provider: eventProvider, target: event.target, threadId: event.threadId });
    return;
  }
  if (applyTurnLifecycleEvent(event, {
    eventProvider,
    isActiveThread,
    runtime: refs.runtime,
    setters: {
      setNotice: setters.setNotice,
      setBusy: setters.setBusy,
      setBusySince: setters.setBusySince,
      setActiveTurnId: setters.setActiveTurnId,
      setStoppingTurn: setters.setStoppingTurn,
      setSteeringPrompt: setters.setSteeringPrompt,
    },
    actions: {
      flushAssistantDeltas: actions.flushAssistantDeltas,
      updateThreadEntries: actions.updateThreadEntries,
    },
  })) return;

  if (event.provider && event.provider !== refs.runtime.activeProvider() && currentTarget) return;
  if (applyThreadSettingsEvent(event, {
    eventProvider,
    currentTarget,
    isActiveThread,
    threadViews: refs.threadViews.current,
    setters: {
      setCurrentModel: setters.setCurrentModel,
      setCurrentEffort: setters.setCurrentEffort,
      setCurrentPermissionProfile: setters.setCurrentPermissionProfile,
      setCurrentModeId: setters.setCurrentModeId,
      setProviderCatalogs: setters.setProviderCatalogs,
    },
  })) return;
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
  if (applyTranscriptContentEvent(event, transcriptDependencies)) return;
  if (event.type === "warning" && isActiveThread) {
    setters.setNotice(`${providerDisplayName(eventProvider)} 알림: ${event.message}`);
  }
}
