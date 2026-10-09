import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider } from "../shared/bridge";
import type { useApprovalQueue } from "../features/conversation/useApprovalQueue";
import type { useActiveConversationState } from "../features/conversation/useActiveConversationState";
import { useConversationEventPipeline } from "../features/conversation/useConversationEventPipeline";
import type { useConversationRuntime } from "../features/conversation/useConversationRuntime";
import { useFileAttachments } from "../features/conversation/useFileAttachments";
import { useImageAttachments } from "../features/conversation/useImageAttachments";
import { createActiveThreadViewLifecycle } from "../features/conversation/active-thread-view-lifecycle";
import { useThreadViewCacheLifecycle } from "../features/conversation/useThreadViewCacheLifecycle";
import { useSlashSkills } from "../features/skills/useSlashSkills";
import type { useThreadViewStore } from "../features/conversation/useThreadViewStore";
import type { useSessionForkState } from "../features/sessions/useSessionForkState";
import type { useWorkspaceNavigation } from "../features/workspace/useWorkspaceNavigation";
import type { useWorkspaceTabs } from "../features/workspace/useWorkspaceTabs";
import type { useDesktopUiRuntime } from "../shared/desktop-ui-runtime";
import type { useConnectionState } from "../features/connection/useConnectionState";

type WorkspaceConversationFeaturesOptions = {
  bridge: ReturnType<typeof useDesktopUiRuntime>["bridge"];
  connectionUi: ReturnType<typeof useConnectionState>;
  conversationUi: ReturnType<typeof useActiveConversationState>;
  approvalQueue: ReturnType<typeof useApprovalQueue>;
  forkUi: ReturnType<typeof useSessionForkState>;
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  tabs: ReturnType<typeof useWorkspaceTabs>;
  threadViews: ReturnType<typeof useThreadViewStore>;
  runtime: ReturnType<typeof useConversationRuntime>;
  threadProvider: AssistantProvider;
  setNotice: Dispatch<SetStateAction<string>>;
};

/** Coordinate transcript events, thread-view lifecycle, attachments, and slash skills. */
export function useWorkspaceConversationFeatures({
  bridge,
  connectionUi,
  conversationUi,
  approvalQueue,
  forkUi,
  navigation,
  tabs,
  threadViews,
  runtime,
  threadProvider,
  setNotice,
}: WorkspaceConversationFeaturesOptions) {
  const { state: connection, setters: connectionSetters } = connectionUi;
  const { state, setters } = conversationUi;
  const { setters: forkSetters } = forkUi;
  const { activePage, setActivePage, setMobileSidebarOpen } = navigation;

  const imageAttachmentState = useImageAttachments({
    state: { provider: threadProvider, busy: state.busy, target: connection.connectedTarget, threadId: state.activeThreadId },
    runtime,
    threadViews: threadViews.current,
    setters: { setDraft: setters.setDraft, setNotice },
  });
  const fileAttachmentState = useFileAttachments({
    state: { provider: threadProvider, busy: state.busy, target: connection.connectedTarget, threadId: state.activeThreadId },
    runtime,
    threadViews: threadViews.current,
    setters: { setDraft: setters.setDraft, setNotice },
  });

  const events = useConversationEventPipeline({
    connectedTarget: connection.connectedTarget,
    threadViews,
    runtime,
    setActiveEntries: setters.setEntries,
    setters: {
      setNotice,
      setThreads: connectionSetters.setThreads,
      setProviderCatalogs: connectionSetters.setProviderCatalogs,
      setApproval: approvalQueue.setApproval,
      setActiveTitle: setters.setActiveTitle,
      setSideChats: forkSetters.setSideChats,
      setCurrentModel: setters.setCurrentModel,
      setCurrentEffort: setters.setCurrentEffort,
      setCurrentPermissionProfile: setters.setCurrentPermissionProfile,
      setCurrentModeId: setters.setCurrentModeId,
      setSlashCommands: setters.setSlashCommands,
      setBusy: setters.setBusy,
      setBusySince: setters.setBusySince,
      setActiveTurnId: setters.setActiveTurnId,
      setStoppingTurn: setters.setStoppingTurn,
      setSteeringPrompt: setters.setSteeringPrompt,
    },
  });

  const slash = useSlashSkills({
    state: {
      connectedTarget: connection.connectedTarget,
      activeThreadId: state.activeThreadId,
      cwd: state.activeCwd,
      provider: threadProvider,
      activePage,
      activeTab: tabs.activeTab,
      draft: state.draft,
      skills: state.skills,
      slashCommands: state.slashCommands,
    },
    refs: { threadViews: threadViews.current },
    setters: {
      setSkills: setters.setSkills,
      setSlashCommands: setters.setSlashCommands,
      setSkillWarnings: setters.setSkillWarnings,
      setSelectedSkill: setters.setSelectedSkill,
      setDraft: setters.setDraft,
    },
    actions: { isThreadSelected: (target, provider, threadId) => runtime.isThreadSelected(target, provider, threadId) },
  });

  const threadViewCacheLifecycle = useThreadViewCacheLifecycle({
    state: {
      connectedTarget: connection.connectedTarget,
      activeThreadId: state.activeThreadId,
      activeThreadProvider: state.activeThreadProvider,
      assistantProvider: connection.assistantProvider,
      draft: state.draft,
      imageAttachments: imageAttachmentState.attachments,
      fileAttachments: fileAttachmentState.attachments,
      activeTitle: state.activeTitle,
      activeCwd: state.activeCwd,
      currentModel: state.currentModel,
      currentEffort: state.currentEffort,
      currentPermissionProfile: state.currentPermissionProfile,
      currentModes: state.currentModes,
      currentModeId: state.currentModeId,
      entries: state.entries,
      skills: state.skills,
      skillWarnings: state.skillWarnings,
    },
    refs: { threadViews: threadViews.current, runtime },
    actions: {
      clearThreadDeltas: events.clearThreadDeltas,
    },
  });

  const activeThreadViewLifecycle = createActiveThreadViewLifecycle({
    refs: { threadViews: threadViews.current, runtime },
    setters: {
      setWorkspaceFileOpenRequest: tabs.setWorkspaceFileOpenRequest,
      setFilePanelOpen: tabs.setFilePanelOpen,
      setConnectedTarget: connectionSetters.setConnectedTarget,
      setConnectedProvider: connectionSetters.setConnectedProvider,
      setActiveThreadProvider: setters.setActiveThreadProvider,
      setAssistantProvider: connectionSetters.setAssistantProvider,
      setActiveThreadId: setters.setActiveThreadId,
      setSlashCommands: setters.setSlashCommands,
      setSelectedSkill: setters.setSelectedSkill,
      setActiveSideChatId: forkSetters.setActiveSideChatId,
      setMobileSidebarOpen,
      setDraft: setters.setDraft,
      setImageAttachments: imageAttachmentState.setAttachments,
      setFileAttachments: fileAttachmentState.setAttachments,
      setActiveTitle: setters.setActiveTitle,
      setActiveCwd: setters.setActiveCwd,
      setCurrentModel: setters.setCurrentModel,
      setModelSettingsDialogOpen: setters.setModelSettingsDialogOpen,
      setCurrentEffort: setters.setCurrentEffort,
      setCurrentPermissionProfile: setters.setCurrentPermissionProfile,
      setCurrentModes: setters.setCurrentModes,
      setCurrentModeId: setters.setCurrentModeId,
      setEntries: setters.setEntries,
      setSkills: setters.setSkills,
      setSkillWarnings: setters.setSkillWarnings,
      setActiveTab: tabs.setActiveTab,
      setActivePage,
      setActiveTurnId: setters.setActiveTurnId,
      setStoppingTurn: setters.setStoppingTurn,
      setBusy: setters.setBusy,
      setBusySince: setters.setBusySince,
      setNotice,
    },
    actions: {
      persistAssistantProvider: bridge.setAssistantProvider,
      invalidateSlashSkillRefresh: slash.invalidateSlashSkillRefresh,
    },
  });

  return { imageAttachmentState, fileAttachmentState, events, slash, threadViewCacheLifecycle, activeThreadViewLifecycle };
}
