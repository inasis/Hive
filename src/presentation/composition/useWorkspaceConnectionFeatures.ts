import type { Dispatch, SetStateAction } from "react";
import { createConnectionViewLifecycle } from "../features/connection/connection-view-lifecycle";
import { useDaemonConnectionSelectionLifecycle } from "../features/connection/useDaemonConnectionSelectionLifecycle";
import { useAdditionalProviderThreads } from "../features/connection/useAdditionalProviderThreads";
import type { useConnectionState } from "../features/connection/useConnectionState";
import { useConnectionWorkflow } from "../features/connection/useConnectionWorkflow";
import type { useWorkspaceConversationFeatures } from "./useWorkspaceConversationFeatures";
import type { useActiveConversationState } from "../features/conversation/useActiveConversationState";
import type { useConversationRuntime } from "../features/conversation/useConversationRuntime";
import type { useThreadViewStore } from "../features/conversation/useThreadViewStore";
import type { useSessionForkState } from "../features/sessions/useSessionForkState";
import type { useWorkspaceNavigation } from "../features/workspace/useWorkspaceNavigation";
import type { useWorkspaceTabs } from "../features/workspace/useWorkspaceTabs";

type WorkspaceConnectionFeaturesOptions = {
  connectionUi: ReturnType<typeof useConnectionState>;
  conversationUi: ReturnType<typeof useActiveConversationState>;
  forkUi: ReturnType<typeof useSessionForkState>;
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  tabs: ReturnType<typeof useWorkspaceTabs>;
  threadViews: ReturnType<typeof useThreadViewStore>;
  runtime: ReturnType<typeof useConversationRuntime>;
  conversationFeatures: ReturnType<typeof useWorkspaceConversationFeatures>;
  platform: { daemonClient: boolean; mobileApp: boolean };
  setNotice: Dispatch<SetStateAction<string>>;
};

/** Coordinate connection transitions with the active workspace view lifecycle. */
export function useWorkspaceConnectionFeatures({
  connectionUi,
  conversationUi,
  forkUi,
  navigation,
  tabs,
  threadViews,
  runtime,
  conversationFeatures,
  platform,
  setNotice,
}: WorkspaceConnectionFeaturesOptions) {
  const { state: connection, setters: connectionSetters } = connectionUi;
  const { state: conversation, setters: conversationSetters } = conversationUi;
  const { setters: forkSetters } = forkUi;
  const { setActivePage, setMobileSidebarOpen, openSettings } = navigation;
  const { events, slash, threadViewCacheLifecycle } = conversationFeatures;

  const loadAdditionalProviderThreads = useAdditionalProviderThreads({
    connectedTarget: connection.connectedTarget,
    setThreads: connectionSetters.setThreads,
    setProviderCatalogs: connectionSetters.setProviderCatalogs,
  });

  const viewLifecycle = createConnectionViewLifecycle({
    refs: { threadViews: threadViews.current, runtime },
    setters: {
      setConnectionState: connectionSetters.setConnectionState,
      setConnectedTarget: connectionSetters.setConnectedTarget,
      setConnectedProvider: connectionSetters.setConnectedProvider,
      setThreads: connectionSetters.setThreads,
      setSideChats: forkSetters.setSideChats,
      clearTerminalContext: () => tabs.setTerminalContext(null),
      setActiveSideChatId: forkSetters.setActiveSideChatId,
      setActiveThreadId: conversationSetters.setActiveThreadId,
      setActiveThreadProvider: conversationSetters.setActiveThreadProvider,
      setActiveTitle: conversationSetters.setActiveTitle,
      setActiveCwd: conversationSetters.setActiveCwd,
      setDraft: conversationSetters.setDraft,
      setEntries: conversationSetters.setEntries,
      setSkills: conversationSetters.setSkills,
      setSkillWarnings: conversationSetters.setSkillWarnings,
      setSlashCommands: conversationSetters.setSlashCommands,
      setProviderCatalogs: connectionSetters.setProviderCatalogs,
      setCurrentModel: conversationSetters.setCurrentModel,
      setCurrentEffort: conversationSetters.setCurrentEffort,
      setCurrentPermissionProfile: conversationSetters.setCurrentPermissionProfile,
      setImageAttachments: conversationFeatures.imageAttachmentState.setAttachments,
      setFileAttachments: conversationFeatures.fileAttachmentState.setAttachments,
      setChatTab: () => tabs.setActiveTab("chat"),
      setSelectedSkill: conversationSetters.setSelectedSkill,
      setBusy: conversationSetters.setBusy,
      setActiveTurnId: conversationSetters.setActiveTurnId,
      setStoppingTurn: conversationSetters.setStoppingTurn,
      setBusySince: conversationSetters.setBusySince,
      clearWorkspaceFileOpenRequest: () => tabs.setWorkspaceFileOpenRequest(null),
    },
    actions: {
      clearAssistantDeltas: events.clearAssistantDeltas,
      invalidateSlashSkillRefresh: slash.invalidateSlashSkillRefresh,
    },
  });

  const workflow = useConnectionWorkflow({
    state: {
      ...connection,
      activeThreadId: conversation.activeThreadId,
      activeThreadProvider: conversation.activeThreadProvider,
      busy: conversation.busy,
      isDaemonClient: platform.daemonClient,
      isMobileApp: platform.mobileApp,
    },
    setters: {
      ...connectionSetters,
      setNotice,
      setActivePage,
      setMobileSidebarOpen,
    },
    actions: {
      cacheActiveThreadView: threadViewCacheLifecycle.cacheActiveThreadView,
      resetWorkspace: viewLifecycle.resetWorkspaceForConnection,
      resetProviderThreadView: viewLifecycle.resetThreadForProviderSwitch,
      clearConnectionState: viewLifecycle.clearConnectionState,
      loadAdditionalProviderThreads,
      openConnectionSettings: () => openSettings("connection"),
    },
  });

  useDaemonConnectionSelectionLifecycle({
    isDaemonClient: platform.daemonClient,
    connectedTarget: connection.connectedTarget,
    assistantProvider: connection.assistantProvider,
    connect: workflow.connect,
    setters: {
      setConnectedTarget: connectionSetters.setConnectedTarget,
      setConnectionState: connectionSetters.setConnectionState,
      setProviderCatalogs: connectionSetters.setProviderCatalogs,
    },
    resetProviderThreadView: viewLifecycle.resetThreadForProviderSwitch,
  });

  return { ...viewLifecycle, loadAdditionalProviderThreads, ...workflow };
}
