import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteCommand, RemoteMode, RemoteSkill, TranscriptEntry } from "../../../shared/bridge";
import type { LocalImageAttachment, ThreadView } from "./session-state";
import type { ThreadViewStore } from "./thread-view-store";
import type { ConversationRuntime } from "./useConversationRuntime";

type StateSetter<T> = Dispatch<SetStateAction<T>>;
export type ThreadViewLifecycleOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    activeThreadProvider: AssistantProvider | null;
    assistantProvider: AssistantProvider;
    draft: string;
    imageAttachments: LocalImageAttachment[];
    activeTitle: string;
    activeCwd: string;
    currentModel: string;
    currentEffort: string | null;
    currentPermissionProfile: string | null;
    currentModes: RemoteMode[];
    currentModeId: string | null;
    entries: TranscriptEntry[];
    skills: RemoteSkill[];
    skillWarnings: string[];
  };
  refs: {
    threadViews: ThreadViewStore;
    runtime: ConversationRuntime;
  };
  setters: {
    setWorkspaceFileOpenRequest(value: null): void;
    setFilePanelOpen: StateSetter<boolean>;
    setConnectedTarget: StateSetter<string>;
    setConnectedProvider: StateSetter<AssistantProvider>;
    setActiveThreadProvider: StateSetter<AssistantProvider | null>;
    setAssistantProvider: StateSetter<AssistantProvider>;
    setActiveThreadId: StateSetter<string>;
    setSlashCommands: StateSetter<RemoteCommand[]>;
    setSelectedSkill: StateSetter<RemoteSkill | null>;
    setActiveSideChatId: StateSetter<string>;
    setMobileSidebarOpen: StateSetter<boolean>;
    setDraft: StateSetter<string>;
    setImageAttachments: StateSetter<LocalImageAttachment[]>;
    setActiveTitle: StateSetter<string>;
    setActiveCwd: StateSetter<string>;
    setCurrentModel: StateSetter<string>;
    setModelSettingsDialogOpen: StateSetter<boolean>;
    setCurrentEffort: StateSetter<string | null>;
    setCurrentPermissionProfile: StateSetter<string | null>;
    setCurrentModes: StateSetter<RemoteMode[]>;
    setCurrentModeId: StateSetter<string | null>;
    setEntries: StateSetter<TranscriptEntry[]>;
    setSkills: StateSetter<RemoteSkill[]>;
    setSkillWarnings: StateSetter<string[]>;
    setActiveTab(value: "chat"): void;
    setActivePage(value: "sessions"): void;
    setActiveTurnId: StateSetter<string>;
    setStoppingTurn: StateSetter<boolean>;
    setBusy: StateSetter<boolean>;
    setBusySince: StateSetter<number | null>;
    setNotice: StateSetter<string>;
  };
  actions: {
    persistAssistantProvider(provider: AssistantProvider): void;
    invalidateSlashSkillRefresh(clearLoading?: boolean): void;
    clearThreadDeltas(target: string, provider: AssistantProvider, threadId: string): void;
  };
};

/** Own saving and restoring the active conversation view across session switches. */
export function useThreadViewLifecycle({ state, refs, setters, actions }: ThreadViewLifecycleOptions) {
  const cacheActiveThreadView = (saveDraft = true, provider = state.activeThreadProvider ?? state.assistantProvider): void => {
    if (!state.connectedTarget || !state.activeThreadId) return;
    if (saveDraft) refs.runtime.saveDraft(state.connectedTarget, provider, state.activeThreadId, state.draft);
    refs.threadViews.setImageAttachments(state.connectedTarget, provider, state.activeThreadId, state.imageAttachments);
    const previous = refs.threadViews.get(state.connectedTarget, provider, state.activeThreadId);
    refs.threadViews.set({
      target: state.connectedTarget,
      threadId: state.activeThreadId,
      provider,
      title: state.activeTitle,
      cwd: state.activeCwd,
      model: state.currentModel,
      effort: state.currentEffort,
      permissionProfile: state.currentPermissionProfile,
      modes: state.currentModes,
      currentModeId: state.currentModeId,
      entries: previous?.entries ?? state.entries,
      skills: state.skills,
      skillWarnings: state.skillWarnings,
    });
  };

  const activateThreadView = (view: ThreadView, sideChatId = ""): void => {
    setters.setWorkspaceFileOpenRequest(null);
    refs.threadViews.set(view);
    refs.runtime.setActiveThread(view.target, view.provider, view.threadId);
    setters.setConnectedTarget(view.target);
    setters.setConnectedProvider(view.provider);
    setters.setActiveThreadProvider(view.provider);
    setters.setAssistantProvider(view.provider);
    actions.persistAssistantProvider(view.provider);
    setters.setActiveThreadId(view.threadId);
    actions.invalidateSlashSkillRefresh(true);
    setters.setSlashCommands([]);
    setters.setSelectedSkill(null);
    setters.setActiveSideChatId(sideChatId);
    setters.setDraft(refs.runtime.draft(view.target, view.provider, view.threadId) ?? "");
    setters.setImageAttachments(refs.threadViews.getImageAttachments(view.target, view.provider, view.threadId) ?? []);
    setters.setActiveTitle(view.title);
    setters.setActiveCwd(view.cwd);
    setters.setCurrentModel(view.model);
    setters.setCurrentEffort(view.effort);
    setters.setCurrentPermissionProfile(view.permissionProfile);
    setters.setCurrentModes(view.modes);
    setters.setCurrentModeId(view.currentModeId);
    setters.setEntries(view.entries);
    setters.setSkills(view.skills);
    setters.setSkillWarnings(view.skillWarnings);
    setters.setActiveTab("chat");
    setters.setActivePage("sessions");
    const runningSince = refs.runtime.runningSince(view.target, view.provider, view.threadId);
    setters.setActiveTurnId(refs.runtime.turnId(view.target, view.provider, view.threadId) ?? "");
    setters.setStoppingTurn(false);
    setters.setBusy(runningSince !== null);
    setters.setBusySince(runningSince);
    setters.setNotice("");
  };

  const removeThreadView = (target: string, provider: AssistantProvider, threadId: string): void => {
    refs.threadViews.delete(target, provider, threadId);
    refs.runtime.clearThread(target, provider, threadId);
    actions.clearThreadDeltas(target, provider, threadId);
  };

  const updateThreadTitle = (target: string, provider: AssistantProvider, threadId: string, title: string): void => {
    refs.threadViews.update(target, provider, threadId, (view) => ({ ...view, title }));
  };

  const clearDeletedActiveThread = (provider: AssistantProvider): void => {
    actions.invalidateSlashSkillRefresh();
    refs.runtime.clearActiveThread(provider);
    setters.setActiveThreadId("");
    setters.setActiveThreadProvider(null);
    setters.setActiveSideChatId("");
    setters.setMobileSidebarOpen(false);
    setters.setFilePanelOpen(false);
    setters.setActiveTitle("");
    setters.setActiveCwd("");
    setters.setWorkspaceFileOpenRequest(null);
    setters.setCurrentModel("");
    setters.setModelSettingsDialogOpen(false);
    setters.setCurrentEffort(null);
    setters.setCurrentPermissionProfile(null);
    setters.setCurrentModes([]);
    setters.setCurrentModeId(null);
    setters.setEntries([]);
    setters.setSkills([]);
    setters.setSkillWarnings([]);
    setters.setSlashCommands([]);
    setters.setSelectedSkill(null);
    setters.setDraft("");
    setters.setImageAttachments([]);
    setters.setActiveTab("chat");
    setters.setBusy(false);
    setters.setActiveTurnId("");
    setters.setStoppingTurn(false);
    setters.setBusySince(null);
  };

  return { cacheActiveThreadView, activateThreadView, removeThreadView, updateThreadTitle, clearDeletedActiveThread };
}
