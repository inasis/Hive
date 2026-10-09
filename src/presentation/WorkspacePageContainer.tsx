import { useMemo, useState, useSyncExternalStore } from "react";
import { useActiveConversationState } from "./features/conversation/useActiveConversationState";
import { useConversationRuntime } from "./features/conversation/useConversationRuntime";
import { useThreadViewStore } from "./features/conversation/useThreadViewStore";
import { useThemeSettings } from "./features/settings/useThemeSettings";
import { useWorkspaceTabs } from "./features/workspace/useWorkspaceTabs";
import { useWorkspaceNavigation } from "./features/workspace/useWorkspaceNavigation";
import { useResponsiveWorkspaceLayout } from "./features/workspace/useResponsiveWorkspaceLayout";
import { deriveWorkspaceViewModel } from "./features/workspace/workspace-view-model";
import { useSkillsBrowser } from "./features/skills/useSkillsBrowser";
import { usePersonaProfiles } from "./features/settings/usePersonaProfiles";
import { useConnectionState } from "./features/connection/useConnectionState";
import { useTransportLifecycleEvents } from "./features/connection/useTransportLifecycleEvents";
import { useSessionForkState } from "./features/sessions/useSessionForkState";
import { useApprovalQueue } from "./features/conversation/useApprovalQueue";
import { useDesktopUiRuntime } from "./shared/desktop-ui-runtime";
import { useWorkspaceConversationFeatures } from "./composition/useWorkspaceConversationFeatures";
import { useWorkspaceConnectionFeatures } from "./composition/useWorkspaceConnectionFeatures";
import { useWorkspaceSessionFeatures } from "./composition/useWorkspaceSessionFeatures";
import { useWorkspaceConversationActionFeatures } from "./composition/useWorkspaceConversationActionFeatures";
import { WorkspacePagePresentation } from "./composition/WorkspacePagePresentation";

export type WorkspacePageContainerProps = {
  isWindowsDesktop?: boolean;
  onChangeDaemonSettings?: () => void;
  onRenameDaemon?: (id: string) => void;
  onUseDirectConnection?: () => void;
  onUseDaemonConnection?: () => void;
};

/** Bind feature state and actions for the active workspace page. */
export function WorkspacePageContainer({ isWindowsDesktop = false, onChangeDaemonSettings, onRenameDaemon, onUseDirectConnection, onUseDaemonConnection }: WorkspacePageContainerProps = {}) {
  const { bridge } = useDesktopUiRuntime();
  const personaProfiles = usePersonaProfiles(bridge.preferences);
  const { isDaemonClient, isLinuxDesktop, isMobileApp } = bridge;
  const daemons = useSyncExternalStore(bridge.daemonConnections.subscribe, bridge.daemonConnections.snapshot);
  const theme = useThemeSettings();
  const connectionUi = useConnectionState({ daemonClient: isDaemonClient });
  const {
    assistantProvider,
    connectedTarget,
    threads,
    providerCatalogs,
  } = connectionUi.state;
  const {
    setTarget,
    setConnectedTarget,
    setConnectedProvider,
    setConnectionState,
    setThreads,
    setProviderCatalogs,
  } = connectionUi.setters;
  const conversationUi = useActiveConversationState();
  const {
    activeThreadId,
    activeThreadProvider,
    activeTitle,
    activeCwd,
    currentModel,
    currentEffort,
    skills,
    busy,
  } = conversationUi.state;
  const sessionForkUi = useSessionForkState();
  const { activeSideChatId, sideChats } = sessionForkUi.state;
  const [notice, setNotice] = useState("");
  const isWideLayout = useResponsiveWorkspaceLayout(isMobileApp);
  const approvalQueue = useApprovalQueue();
  const workspaceNavigation = useWorkspaceNavigation({
    initialPage: isDaemonClient || Boolean(connectionUi.state.target) ? "sessions" : "settings",
  });
  const { setActivePage, closeMobileSidebar } = workspaceNavigation;

  const threadViews = useThreadViewStore();
  const conversationRuntime = useConversationRuntime(assistantProvider);
  const workspaceView = deriveWorkspaceViewModel({
    assistantProvider,
    activeThreadProvider,
    connectedTarget,
    activeThreadId,
    providerCatalogs,
    sideChats,
    threads,
    busy,
    currentModel,
    currentEffort,
    runtime: conversationRuntime,
    threadViews: threadViews.current,
  });
  const {
    threadProvider,
    threadProviderName,
    models,
    activeSideChat,
    chatRootThreadId,
  } = workspaceView;
  const workspaceTabs = useWorkspaceTabs({
    target: connectedTarget,
    cwd: activeCwd,
    isMobileApp,
    isWideLayout,
    closeMobileSidebar,
  });
  const conversationFeatures = useWorkspaceConversationFeatures({
    bridge,
    connectionUi,
    conversationUi,
    approvalQueue,
    forkUi: sessionForkUi,
    navigation: workspaceNavigation,
    tabs: workspaceTabs,
    threadViews,
    runtime: conversationRuntime,
    threadProvider,
    setNotice,
  });
  const transportEventSetters = useMemo(() => ({
    setConnectionState,
    setNotice,
    setTarget,
    setConnectedTarget,
    setThreads,
    setProviderCatalogs,
    setActivePage,
    setConnectedProvider,
  }), []);

  const skillsBrowser = useSkillsBrowser(skills);
  const connectionFeatures = useWorkspaceConnectionFeatures({
    connectionUi,
    conversationUi,
    forkUi: sessionForkUi,
    navigation: workspaceNavigation,
    tabs: workspaceTabs,
    threadViews,
    runtime: conversationRuntime,
    conversationFeatures,
    platform: { daemonClient: isDaemonClient, mobileApp: isMobileApp },
    setNotice,
  });
  const { loadAdditionalProviderThreads } = connectionFeatures;

  const sessionFeatures = useWorkspaceSessionFeatures({
    connectionUi,
    conversationUi,
    forkUi: sessionForkUi,
    navigation: workspaceNavigation,
    tabs: workspaceTabs,
    threadViews,
    runtime: conversationRuntime,
    conversationFeatures,
    connectionFeatures,
    conversationEvents: conversationFeatures.events,
    view: { threadProvider, threadProviderName, chatRootThreadId, activeSideChat, models },
    platform: { linuxDesktop: isLinuxDesktop, daemonClient: isDaemonClient },
    approvalQueue,
    setNotice,
  });
  const { lifecycle } = sessionFeatures;
  const { openThread } = lifecycle;

  useTransportLifecycleEvents({
    provider: assistantProvider,
    activeThread: {
      target: connectedTarget,
      sideChatId: activeSideChatId,
      thread: activeThreadId ? {
        id: activeThreadId,
        provider: activeThreadProvider ?? threadProvider,
        title: activeTitle,
        cwd: activeCwd,
        preview: "",
        updatedAt: null,
      } : null,
    },
    setters: transportEventSetters,
    loadAdditionalProviderThreads,
    restoreThread: (thread, sideChatId) => openThread(connectedTarget, thread, sideChatId),
  });

  const { turnControls, composerSubmission, approvalResponse } = useWorkspaceConversationActionFeatures({
    connectionUi,
    conversationUi,
    conversationFeatures,
    connectionFeatures,
    sessionFeatures,
    navigation: workspaceNavigation,
    view: workspaceView,
    skillsBrowser,
    approvalQueue,
    threadViews,
    runtime: conversationRuntime,
    setNotice,
  });

  return <WorkspacePagePresentation
    isWindowsDesktop={isWindowsDesktop}
    externalActions={{ onChangeDaemonSettings, onRenameDaemon, onUseDirectConnection, onUseDaemonConnection }}
    platform={{ isDaemonClient, isLinuxDesktop, isMobileApp, isWideLayout }}
    personaProfiles={personaProfiles}
    daemons={daemons}
    theme={theme}
    connectionUi={connectionUi}
    conversationUi={conversationUi}
    forkUi={sessionForkUi}
    navigation={workspaceNavigation}
    tabs={workspaceTabs}
    view={workspaceView}
    conversationFeatures={conversationFeatures}
    connectionFeatures={connectionFeatures}
    sessionFeatures={sessionFeatures}
    skillsBrowser={skillsBrowser}
    approvalQueue={approvalQueue}
    turnControls={turnControls}
    composerSubmission={composerSubmission}
    approvalResponse={approvalResponse}
    notice={notice}
    setNotice={setNotice}
  />;
}
