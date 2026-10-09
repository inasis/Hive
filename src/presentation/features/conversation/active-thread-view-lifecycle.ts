import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteCommand, RemoteMode, RemoteSkill, TranscriptEntry } from "../../shared/bridge";
import type { LocalFileAttachment, LocalImageAttachment, ThreadView } from "../../shared/conversation-view";
import type { ThreadViewStorePort, ConversationRuntimePort } from "../../shared/conversation-store";
import { resolveThreadActivity } from "./thread-activity-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;
export type ActiveThreadViewLifecycleOptions = {
  refs: {
    threadViews: ThreadViewStorePort;
    runtime: ConversationRuntimePort;
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
    setFileAttachments: StateSetter<LocalFileAttachment[]>;
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
  };
};

/** Own projection of a selected thread into active conversation state. */
export function createActiveThreadViewLifecycle({ refs, setters, actions }: ActiveThreadViewLifecycleOptions) {
  const activateThreadView = (view: ThreadView, sideChatId = ""): void => {
    setters.setWorkspaceFileOpenRequest(null);
    refs.threadViews.set(view);
    refs.runtime.setActiveThread(view.target, view.provider, view.threadId);
    reconcileThreadActivity(view, refs.runtime);
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
    setters.setFileAttachments(refs.threadViews.getFileAttachments(view.target, view.provider, view.threadId) ?? []);
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
    setters.setFileAttachments([]);
    setters.setActiveTab("chat");
    setters.setBusy(false);
    setters.setActiveTurnId("");
    setters.setStoppingTurn(false);
    setters.setBusySince(null);
  };

  return { activateThreadView, clearDeletedActiveThread };
}

function reconcileThreadActivity(view: ThreadView, runtime: ConversationRuntimePort): void {
  const key = [view.target, view.provider, view.threadId] as const;
  const activity = resolveThreadActivity(view.entries, runtime.turnId(...key));

  if (!activity.running) {
    runtime.clearTurnTracking(...key);
    return;
  }

  runtime.startThread(...key, runtime.runningSince(...key) ?? Date.now());
  if (activity.turnId) runtime.setTurnId(...key, activity.turnId);
  else runtime.clearTurnId(...key);
}
