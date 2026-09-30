import type { AssistantProvider, RemoteCommand, RemoteSkill, RemoteThread, TranscriptEntry } from "../../../shared/bridge";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import type { SideChatTab } from "../../shared/conversation-view";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { ConversationRuntimePort } from "../../shared/conversation-store";

/** Define connection transitions that reset or preserve the active UI session view. */
export function createConnectionViewLifecycle(dependencies: {
  refs: {
    threadViews: ThreadViewStorePort;
    runtime: ConversationRuntimePort;
  };
  setters: {
    setConnectionState(value: BridgeConnectionState): void;
    setConnectedTarget(value: string): void;
    setConnectedProvider(value: AssistantProvider): void;
    setThreads(value: RemoteThread[]): void;
    setSideChats(value: SideChatTab[]): void;
    clearTerminalContext(): void;
    setActiveSideChatId(value: string): void;
    setActiveThreadId(value: string): void;
    setActiveThreadProvider(value: AssistantProvider | null): void;
    setActiveTitle(value: string): void;
    setActiveCwd(value: string): void;
    setDraft(value: string): void;
    setEntries(value: TranscriptEntry[]): void;
    setSkills(value: RemoteSkill[]): void;
    setSkillWarnings(value: string[]): void;
    setSlashCommands(value: RemoteCommand[]): void;
    setProviderCatalogs(value: ProviderCatalogs): void;
    setCurrentModel(value: string): void;
    setCurrentEffort(value: string | null): void;
    setCurrentPermissionProfile(value: string | null): void;
    setChatTab(): void;
    setSelectedSkill(value: RemoteSkill | null): void;
    setBusy(value: boolean): void;
    setActiveTurnId(value: string): void;
    setStoppingTurn(value: boolean): void;
    setBusySince(value: number | null): void;
    clearWorkspaceFileOpenRequest(): void;
  };
  actions: {
    clearAssistantDeltas(): void;
    invalidateSlashSkillRefresh(clearLoading?: boolean): void;
  };
}) {
  const { refs, setters, actions } = dependencies;

  const resetWorkspaceForConnection = (provider: AssistantProvider): void => {
    refs.threadViews.clear();
    refs.runtime.clearDrafts();
    setters.setThreads([]);
    setters.setSideChats([]);
    setters.clearTerminalContext();
    setters.setActiveSideChatId("");
    setters.setActiveThreadId("");
    setters.setActiveThreadProvider(null);
    setters.setActiveTitle("");
    setters.setActiveCwd("");
    setters.setDraft("");
    setters.setEntries([]);
    setters.setSkills([]);
    setters.setSkillWarnings([]);
    setters.setSlashCommands([]);
    setters.setProviderCatalogs({});
    setters.setCurrentModel("");
    setters.setCurrentEffort(null);
    setters.setCurrentPermissionProfile(null);
    setters.setChatTab();
    refs.runtime.clearActiveThread(provider);
  };

  const resetThreadForProviderSwitch = (provider: AssistantProvider): void => {
    setters.setActiveSideChatId("");
    setters.setActiveThreadId("");
    setters.setActiveThreadProvider(null);
    setters.setActiveTitle("");
    setters.setActiveCwd("");
    setters.setEntries([]);
    setters.setSkills([]);
    setters.setSkillWarnings([]);
    setters.setSlashCommands([]);
    setters.setSelectedSkill(null);
    setters.setDraft("");
    setters.setChatTab();
    refs.runtime.clearActiveThread(provider);
  };

  const clearConnectionState = (provider: AssistantProvider): void => {
    setters.setConnectionState("disconnected");
    setters.setConnectedTarget("");
    setters.setConnectedProvider(provider);
    setters.setActiveThreadId("");
    actions.invalidateSlashSkillRefresh(true);
    setters.setSelectedSkill(null);
    setters.setActiveThreadProvider(null);
    setters.setActiveSideChatId("");
    setters.setSideChats([]);
    setters.clearWorkspaceFileOpenRequest();
    setters.clearTerminalContext();
    setters.setChatTab();
    refs.threadViews.clear();
    actions.clearAssistantDeltas();
    refs.runtime.clear(provider);
    setters.setBusy(false);
    setters.setActiveTurnId("");
    setters.setStoppingTurn(false);
    setters.setBusySince(null);
    setters.setCurrentModel("");
    setters.setCurrentEffort(null);
    setters.setThreads([]);
    setters.setProviderCatalogs({});
    setters.setEntries([]);
    setters.setSkills([]);
    setters.setSlashCommands([]);
  };

  return { resetWorkspaceForConnection, resetThreadForProviderSwitch, clearConnectionState };
}
