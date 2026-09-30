import { useMemo, useState } from "react";
import { useActiveConversationState } from "./features/conversation/useActiveConversationState";
import { useImageAttachments } from "./features/conversation/useImageAttachments";
import { useConversationRuntime } from "./features/conversation/useConversationRuntime";
import { useThreadViewStore } from "./features/conversation/useThreadViewStore";
import { useConversationEventPipeline } from "./features/conversation/useConversationEventPipeline";
import { useThreadViewLifecycle } from "./features/conversation/useThreadViewLifecycle";
import { AppDialogHost } from "./features/sessions/AppDialogHost";
import { getConnectionPresentation } from "./features/connection/connection-presentation";
import { useThemeSettings } from "./features/settings/useThemeSettings";
import { useWorkspaceTabs } from "./features/workspace/useWorkspaceTabs";
import { useWorkspaceNavigation } from "./features/workspace/useWorkspaceNavigation";
import { useResponsiveWorkspaceLayout } from "./features/workspace/useResponsiveWorkspaceLayout";
import { deriveWorkspaceViewModel } from "./features/workspace/workspace-view-model";
import { WorkspacePageContent } from "./WorkspacePageContent";
import { WorkspaceFrame } from "./features/workspace/WorkspaceFrame";
import { TerminalPanel } from "./features/workspace/TerminalPanel";
import { useWindowControls } from "./features/window/useWindowControls";
import { useWindowResize } from "./features/window/useWindowResize";
import type { ApprovalUiRequest } from "./shared/bridge-event-adapter";
import { useApprovalResponse } from "./features/conversation/useApprovalResponse";
import { useComposerSubmission } from "./features/conversation/useComposerSubmission";
import { useConversationTurnControls } from "./features/conversation/useConversationTurnControls";
import { useSlashSkills } from "./features/skills/useSlashSkills";
import { useSkillsBrowser } from "./features/skills/useSkillsBrowser";
import { useConnectionWorkflow } from "./features/connection/useConnectionWorkflow";
import { formatWorkspaceTargetLabel } from "./shared/workspace-target-label";
import { useConnectionState } from "./features/connection/useConnectionState";
import { useAdditionalProviderThreads } from "./features/connection/useAdditionalProviderThreads";
import { useTransportLifecycleEvents } from "./features/connection/useTransportLifecycleEvents";
import { createConnectionViewLifecycle } from "./features/connection/connection-view-lifecycle";
import { useSessionManagement } from "./features/sessions/useSessionManagement";
import { useSessionWorkflows } from "./features/sessions/useSessionWorkflows";
import { useChatTabNavigation } from "./features/sessions/useChatTabNavigation";
import { useResponseFork } from "./features/sessions/useResponseFork";
import { useSideChatCreation } from "./features/sessions/useSideChatCreation";
import { useSessionForkState } from "./features/sessions/useSessionForkState";
import { useSessionSettings } from "./features/sessions/useSessionSettings";
import { isDaemonClient, isLinuxDesktop, isMobileApp, setAssistantProvider as persistAssistantProvider } from "./bridgeClient";
import { LOCAL_WORKSPACE_TARGET } from "../shared/bridge";

export function App({ isWindowsDesktop = false, onChangeDaemonSettings, onUseDirectConnection, onUseDaemonConnection }: {
  isWindowsDesktop?: boolean;
  onChangeDaemonSettings?: () => void;
  onUseDirectConnection?: () => void;
  onUseDaemonConnection?: () => void;
} = {}) {
  const { theme, setTheme, toggleTheme } = useThemeSettings();
  const connectionUi = useConnectionState({ daemonClient: isDaemonClient });
  const {
    assistantProvider,
    availableProviders,
    target,
    connectedTarget,
    connectedProvider,
    connectionState,
    threads,
    providerCatalogs,
  } = connectionUi.state;
  const {
    setAssistantProvider: setAssistantProviderState,
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
    modelSettingsDialogOpen,
    currentEffort,
    currentPermissionProfile,
    currentModes,
    currentModeId,
    entries,
    skills,
    skillWarnings,
    slashCommands,
    selectedSkill,
    draft,
    busy,
    activeTurnId,
    stoppingTurn,
    steeringPrompt,
    busyElapsed,
  } = conversationUi.state;
  const {
    setActiveThreadId,
    setActiveThreadProvider,
    setActiveTitle,
    setActiveCwd,
    setCurrentModel,
    setModelSettingsDialogOpen,
    setCurrentEffort,
    setCurrentPermissionProfile,
    setCurrentModes,
    setCurrentModeId,
    setEntries,
    setSkills,
    setSkillWarnings,
    setSlashCommands,
    setSelectedSkill,
    setDraft,
    setBusy,
    setActiveTurnId,
    setStoppingTurn,
    setSteeringPrompt,
    setBusySince,
  } = conversationUi.setters;
  const sessionForkUi = useSessionForkState();
  const { activeSideChatId, sideChats } = sessionForkUi.state;
  const { setActiveSideChatId, setSideChats } = sessionForkUi.setters;
  const [notice, setNotice] = useState("");
  const isWideLayout = useResponsiveWorkspaceLayout(isMobileApp);
  const [approval, setApproval] = useState<ApprovalUiRequest | null>(null);
  const workspaceNavigation = useWorkspaceNavigation({
    initialPage: isDaemonClient || Boolean(connectionUi.state.target) ? "sessions" : "settings",
  });
  const {
    activePage,
    setActivePage,
    settingsSection,
    setSettingsSection,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    desktopSidebarCollapsed,
    setDesktopSidebarCollapsed,
    closeMobileSidebar,
    openSettings,
    navigate,
  } = workspaceNavigation;

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
    assistantProviderName,
    models,
    modelWarning,
    activeSideChat,
    chatRootThreadId,
    visibleSideChats,
    activeThreadHasUnfinishedResponse,
    mainThreadLabel,
    selectedModel,
    reasoningOptions,
    displayedEffort,
  } = workspaceView;
  const imageAttachmentState = useImageAttachments({
    state: { provider: threadProvider, busy, target: connectedTarget, threadId: activeThreadId },
    runtime: conversationRuntime,
    threadViews: threadViews.current,
    setters: { setDraft, setNotice },
  });
  const {
    attachments: imageAttachments,
    setAttachments: setImageAttachments,
    addImages,
    removeImage,
  } = imageAttachmentState;
  const {
    activeTab,
    setActiveTab,
    activeFileTab,
    terminalContext,
    setTerminalContext,
    tabCreateMenuOpen,
    setTabCreateMenuOpen,
    tabCreateMenuPosition,
    tabCreateMenuRef,
    tabCreateButtonRef,
    toggleTabCreateMenu,
    workspaceFileTabs,
    filePanelOpen,
    setFilePanelOpen,
    filePanelInitialized,
    workspaceFileOpenRequest,
    setWorkspaceFileOpenRequest,
    filesPanelRef,
    collapsedProjects,
    openWorkspaceMarkdownFile,
    openWorkspaceFileTab,
    handleWorkspaceFileOpenHandled,
    openTerminalTab,
    closeTerminalTab,
    toggleProject,
    toggleFilePanel,
    closeWorkspaceFileTab,
  } = useWorkspaceTabs({
    target: connectedTarget,
    cwd: activeCwd,
    isMobileApp,
    isWideLayout,
    closeMobileSidebar,
  });

  const {
    windowMaximized,
    gtkSettings,
    gtkTopbarStyle,
    gtkControlStyle,
    sidebarGtkLeftDecorations,
    sidebarGtkRightDecorations,
    topbarGtkLeftDecorations,
    topbarGtkRightDecorations,
    renderGtkDecorations,
    renderWindowsControls,
  } = useWindowControls({
    isLinuxDesktop,
    desktopSidebarCollapsed,
    onActivePage: (page) => setActivePage(page),
    onNotice: setNotice,
    onDetectedTheme: setTheme,
  });
  const { beginWindowResize, moveWindowResize, endWindowResize } = useWindowResize(setNotice);

  const loadAdditionalProviderThreads = useAdditionalProviderThreads({ setThreads, setProviderCatalogs });

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

  const { filter, setFilter, provider: skillProvider, setProvider: setSkillProvider, visibleSkills } = useSkillsBrowser(skills);
  const conversationEventPipeline = useConversationEventPipeline({
    connectedTarget,
    threadViews,
    runtime: conversationRuntime,
    setActiveEntries: setEntries,
    setters: {
      setNotice,
      setThreads,
      setProviderCatalogs,
      setApproval,
      setActiveTitle,
      setSideChats,
      setCurrentModel,
      setCurrentEffort,
      setCurrentPermissionProfile,
      setCurrentModeId,
      setSlashCommands,
      setBusy,
      setBusySince,
      setActiveTurnId,
      setStoppingTurn,
      setSteeringPrompt,
    },
  });
  const {
    updateThreadEntries,
    flushAssistantDeltas,
    clearThreadDeltas,
    clearAssistantDeltas,
  } = conversationEventPipeline;

  const {
    slashMenuOpen,
    slashSkillIndex,
    setSlashSkillIndex,
    visibleSlashItems,
    slashSkillLoading,
    invalidateSlashSkillRefresh,
    chooseSlashMenuItem,
  } = useSlashSkills({
    state: {
      connectedTarget,
      activeThreadId,
      cwd: activeCwd,
      provider: threadProvider,
      activePage,
      activeTab,
      draft,
      skills,
      slashCommands,
    },
    refs: { threadViews: threadViews.current },
    setters: { setSkills, setSlashCommands, setSkillWarnings, setSelectedSkill, setDraft },
    actions: { isThreadSelected: (target, provider, threadId) => conversationRuntime.isThreadSelected(target, provider, threadId) },
  });

  const {
    cacheActiveThreadView,
    activateThreadView,
    removeThreadView,
    updateThreadTitle,
    clearDeletedActiveThread,
  } = useThreadViewLifecycle({
    state: {
      connectedTarget,
      activeThreadId,
      activeThreadProvider,
      assistantProvider,
      draft,
      imageAttachments,
      activeTitle,
      activeCwd,
      currentModel,
      currentEffort,
      currentPermissionProfile,
      currentModes,
      currentModeId,
      entries,
      skills,
      skillWarnings,
    },
    refs: {
      threadViews: threadViews.current,
      runtime: conversationRuntime,
    },
    setters: {
      setWorkspaceFileOpenRequest,
      setFilePanelOpen,
      setConnectedTarget,
      setConnectedProvider,
      setActiveThreadProvider,
      setAssistantProvider: setAssistantProviderState,
      setActiveThreadId,
      setSlashCommands,
      setSelectedSkill,
      setActiveSideChatId,
      setMobileSidebarOpen,
      setDraft,
      setImageAttachments,
      setActiveTitle,
      setActiveCwd,
      setCurrentModel,
      setModelSettingsDialogOpen,
      setCurrentEffort,
      setCurrentPermissionProfile,
      setCurrentModes,
      setCurrentModeId,
      setEntries,
      setSkills,
      setSkillWarnings,
      setActiveTab,
      setActivePage,
      setActiveTurnId,
      setStoppingTurn,
      setBusy,
      setBusySince,
      setNotice,
    },
    actions: { persistAssistantProvider, invalidateSlashSkillRefresh, clearThreadDeltas },
  });

  const { resetWorkspaceForConnection, resetThreadForProviderSwitch, clearConnectionState } = createConnectionViewLifecycle({
    refs: {
      threadViews: threadViews.current,
      runtime: conversationRuntime,
    },
    setters: {
      setConnectionState,
      setConnectedTarget,
      setConnectedProvider,
      setThreads,
      setSideChats,
      clearTerminalContext: () => setTerminalContext(null),
      setActiveSideChatId,
      setActiveThreadId,
      setActiveThreadProvider,
      setActiveTitle,
      setActiveCwd,
      setDraft,
      setEntries,
      setSkills,
      setSkillWarnings,
      setSlashCommands,
      setProviderCatalogs,
      setCurrentModel,
      setCurrentEffort,
      setCurrentPermissionProfile,
      setChatTab: () => setActiveTab("chat"),
      setSelectedSkill,
      setBusy,
      setActiveTurnId,
      setStoppingTurn,
      setBusySince,
      clearWorkspaceFileOpenRequest: () => setWorkspaceFileOpenRequest(null),
    },
    actions: { clearAssistantDeltas, invalidateSlashSkillRefresh },
  });

  const { connect, chooseProvider, refresh, disconnect } = useConnectionWorkflow({
    state: {
      ...connectionUi.state,
      activeThreadId,
      activeThreadProvider,
      busy,
      isDaemonClient,
      isMobileApp,
    },
    setters: {
      ...connectionUi.setters,
      setNotice,
      setActivePage,
      setMobileSidebarOpen,
    },
    actions: {
      cacheActiveThreadView,
      resetWorkspace: resetWorkspaceForConnection,
      resetProviderThreadView: resetThreadForProviderSwitch,
      clearConnectionState,
      loadAdditionalProviderThreads,
      openConnectionSettings: () => openSettings("connection"),
    },
  });

  const {
    renameDialog,
    setRenameDialog,
    renameSessionName,
    setRenameSessionName,
    renameSessionError,
    setRenameSessionError,
    renamingSession,
    deleteDialog,
    setDeleteDialog,
    deleteSessionError,
    deletingSession,
    deletingThreadIsRunning,
    openRenameSessionDialog,
    openDeleteSessionDialog,
    saveSessionName,
    deleteSession,
  } = useSessionManagement({
    state: {
      connectedTarget,
      threadProvider,
      activeThreadId,
      chatRootThreadId,
    },
    setters: { setThreads, setSideChats, setActiveTitle, setNotice },
    actions: {
      isThreadRunning: (target, provider, threadId) => conversationRuntime.isRunning(target, provider, threadId),
      removeThreadCache: (target, thread) => removeThreadView(target, thread.provider, thread.id),
      updateCachedThreadTitle: updateThreadTitle,
      clearActiveThreadAfterDeletion: clearDeletedActiveThread,
    },
  });

  const {
    creatingSession,
    openingThread,
    newSessionDialog,
    openNewSessionDialog,
    closeNewSessionDialog,
    changeNewSessionPath,
    changeNewSessionName,
    setNewPermissionPresets,
    chooseWorkspaceFolder,
    createSessionInWorkspace,
    openThread,
  } = useSessionWorkflows({
    state: { connectedTarget, assistantProvider, connectedProvider },
    platform: { linuxDesktop: isLinuxDesktop, daemonClient: isDaemonClient },
    setters: {
      setThreads,
      setProviderCatalogs,
      setNotice,
      setDraft,
      setMobileSidebarOpen,
      setBusy,
      setBusySince,
      setApproval,
    },
    actions: {
      cacheActiveThreadView: () => cacheActiveThreadView(),
      flushAssistantDeltas,
      activateThreadView,
      connect,
    },
  });

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
    restoreThread: (thread, sideChatId) => openThread(LOCAL_WORKSPACE_TARGET, thread, sideChatId),
  });

  const { forkingEntryId, forkCompletedResponse } = useResponseFork({
    state: {
      connectedTarget,
      activeThreadId,
      activeTitle,
      threadProvider,
      activeSideChat,
      sideChats,
      busy,
      openingThread,
    },
    refs: { threadViews: threadViews.current },
    setters: {
      setThreads,
      setProviderCatalogs,
      setSideChats,
      setActiveTab,
      setMobileSidebarOpen,
      setNotice,
    },
    actions: {
      flushAssistantDeltas,
      cacheActiveThreadView: (saveDraft) => cacheActiveThreadView(saveDraft),
      activateThreadView,
    },
  });

  const { creatingSideChat, createSideChat } = useSideChatCreation({
    state: {
      connectedTarget,
      activeThreadId,
      threadProvider,
      activeSideChat,
      sideChats,
      openingThread,
    },
    refs: { threadViews: threadViews.current, runtime: conversationRuntime },
    setters: {
      setProviderCatalogs,
      setSideChats,
      setDraft,
      setBusy,
      setActiveTurnId,
      setStoppingTurn,
      setBusySince,
      setNotice,
    },
    actions: {
      flushAssistantDeltas,
      cacheActiveThreadView: (saveDraft) => cacheActiveThreadView(saveDraft),
      activateThreadView,
      updateThreadEntries,
    },
  });

  const { switchChatTab, closeSideChat } = useChatTabNavigation({
    state: { connectedTarget, activeThreadId, threadProvider, activeTab, threads },
    refs: { threadViews: threadViews.current },
    setters: { setSideChats, setActiveSideChatId, setActiveTab },
    actions: {
      flushAssistantDeltas,
      cacheActiveThreadView: (saveDraft) => cacheActiveThreadView(saveDraft),
      activateThreadView,
      openThread,
    },
  });

  const { steerPrompt, stopTurn } = useConversationTurnControls({
    state: {
      connectedTarget,
      activeThreadId,
      activeCwd,
      threadProvider,
      threadProviderName,
      busy,
      steeringPrompt,
      stoppingTurn,
      activeTurnId,
    },
    refs: {
      runtime: conversationRuntime,
    },
    setters: {
      setDraft,
      setSteeringPrompt,
      setNotice,
      setStoppingTurn,
      setSelectedSkill,
    },
    actions: {
      updateThreadEntries,
    },
  });

  const { sendPrompt } = useComposerSubmission({
    state: {
      connectedTarget,
      activeThreadId,
      activeCwd,
      threadProvider,
      threadProviderName,
      draft,
      imageAttachments,
      slashMenuOpen,
      slashSkillLoading,
      slashCommands,
      selectedSkill,
      busy,
      threads,
      currentModel,
      modelWarning,
      models,
    },
    refs: { threadViews: threadViews.current, runtime: conversationRuntime },
    setters: {
      setDraft,
      setNotice,
      setSlashCommands,
      setModelSettingsDialogOpen,
      setThreads,
      setImageAttachments,
      setBusy,
      setActiveTurnId,
      setStoppingTurn,
      setSteeringPrompt,
      setBusySince,
      setSelectedSkill,
    },
    actions: {
      openThread,
      steerPrompt,
      updateThreadEntries,
    },
    hiveCommands: {
      setters: { setFilter, setActivePage, setSettingsSection },
      actions: { disconnect: () => disconnect(), createSideChat },
    },
  });

  const { answerApproval } = useApprovalResponse({
    state: { connectedTarget, approval },
    setters: { setNotice, setApproval },
  });

  const { updatingSettings, updateSettings, changeModel } = useSessionSettings({
    state: {
      connectedTarget,
      activeThreadId,
      provider: threadProvider,
      providerName: threadProviderName,
      currentModel,
      currentEffort,
      models,
      modes: currentModes,
      permissionPresets: providerCatalogs[threadProvider]?.permissionPresets ?? [],
    },
    refs: { threadViews: threadViews.current },
    setters: {
      setProviderCatalogs,
      setCurrentModel,
      setCurrentEffort,
      setCurrentPermissionProfile,
      setCurrentModeId,
      setNotice,
    },
  });

  const toggleSidebar = () => {
    if (isMobileApp && !isWideLayout) {
      const nextOpen = !mobileSidebarOpen;
      if (nextOpen) setFilePanelOpen(false);
      setMobileSidebarOpen(nextOpen);
      return;
    }
    setDesktopSidebarCollapsed((collapsed) => !collapsed);
  };

  const dialogHost = <AppDialogHost
    newSession={{
      state: {
        open: newSessionDialog.open,
        mode: newSessionDialog.mode,
        path: newSessionDialog.path,
        name: newSessionDialog.name,
        permissionPresets: newSessionDialog.permissionPresets,
        error: newSessionDialog.error,
        creating: creatingSession,
        choosingWorkspaceFolder: newSessionDialog.choosingWorkspaceFolder,
        busy,
      },
      provider: {
        current: assistantProvider,
        name: assistantProviderName,
        options: availableProviders,
        permissionPresets: providerCatalogs[assistantProvider]?.permissionPresets ?? [],
        connectionState,
        connectedProvider,
      },
      platform: { linuxDesktop: isLinuxDesktop, daemonClient: isDaemonClient },
      actions: {
        close: closeNewSessionDialog,
        submit: () => void createSessionInWorkspace(newSessionDialog.path, newSessionDialog.name),
        chooseProvider: (next) => chooseProvider(next, true),
        changePath: changeNewSessionPath,
        changeName: changeNewSessionName,
        changePermissionPresets: setNewPermissionPresets,
        chooseWorkspaceFolder: () => void chooseWorkspaceFolder(),
      },
    }}
    sessions={{
      model: {
        open: modelSettingsDialogOpen,
        threadId: activeThreadId,
        provider: threadProvider,
        providerName: threadProviderName,
        currentModel,
        models,
        permissionPresets: providerCatalogs[threadProvider]?.permissionPresets ?? [],
        selectedModel,
        warning: modelWarning,
        updating: updatingSettings,
        busy,
        displayedEffort,
        reasoningOptions,
        modes: currentModes,
        currentModeId,
        permissionProfile: currentPermissionProfile,
      },
      modelActions: {
        close: () => setModelSettingsDialogOpen(false),
        update: (change) => void updateSettings(change),
        changeModel,
      },
      rename: { draft: renameDialog, name: renameSessionName, error: renameSessionError, saving: renamingSession, providerName: assistantProviderName },
      renameActions: {
        close: () => setRenameDialog(null),
        changeName: (value) => { setRenameSessionName(value); setRenameSessionError(""); },
        save: () => void saveSessionName(),
      },
      approval,
      onAnswerApproval: (answer) => void answerApproval(answer),
      deletion: {
        thread: deleteDialog,
        error: deleteSessionError,
        deleting: deletingSession,
        running: deletingThreadIsRunning,
      },
      deleteActions: { close: () => setDeleteDialog(null), confirm: () => void deleteSession() },
    }}
  />;

  return (
    <WorkspaceFrame
            layout={{ activePage, settingsSection, activeTitle, mobileSidebarOpen, desktopSidebarCollapsed, isMobileApp, isWindowsDesktop, isWideLayout, isLinuxDesktop, filePanelOpen, filePanelInitialized }}
      actions={{
        toggleSidebar,
        dismissMobilePanels: () => { setMobileSidebarOpen(false); setFilePanelOpen(false); },
        toggleFilePanel,
      }}
      sidebar={{
        layout: { activePage, mobileSidebarOpen },
        provider: { assistantProvider, assistantProviderName, threadProvider, daemonClient: isDaemonClient, connectionState },
        sessions: { threads, connectedTarget, chatRootThreadId, collapsedProjects, creatingSession, openingThread, renamingSession, deletingSession },
        gtk: {
          leftControls: sidebarGtkLeftDecorations.length > 0 ? <div className="window-controls window-controls-left sidebar-window-controls electrobun-webkit-app-region-no-drag" style={gtkControlStyle} aria-label="왼쪽 창 제어">{renderGtkDecorations(sidebarGtkLeftDecorations, "left")}</div> : undefined,
          rightControls: sidebarGtkRightDecorations.length > 0 ? <div className="window-controls window-controls-right sidebar-window-controls electrobun-webkit-app-region-no-drag" style={gtkControlStyle} aria-label="오른쪽 창 제어">{renderGtkDecorations(sidebarGtkRightDecorations, "right")}</div> : undefined,
        },
        actions: {
          openNewWorkspace: () => { navigate("sessions"); openNewSessionDialog("workspace"); },
          openNewSession: (path) => { navigate("sessions"); openNewSessionDialog("session", path); },
          refresh: () => { void refresh(); },
          openThread: (requestedTarget, thread) => { navigate("sessions"); void openThread(requestedTarget, thread); },
          openRenameSession: openRenameSessionDialog,
          openDeleteSession: openDeleteSessionDialog,
          toggleProject,
          navigate,
          openSettings: () => openSettings(),
        },
      }}
      windowChrome={{ gtkSettings, gtkTopbarStyle, gtkControlStyle, topbarGtkLeftDecorations, topbarGtkRightDecorations, renderGtkDecorations, renderWindowsControls }}
      windowResize={{
        maximized: windowMaximized,
        overlayOpen: newSessionDialog.open || Boolean(renameDialog) || Boolean(deleteDialog) || Boolean(approval),
        begin: beginWindowResize,
        move: moveWindowResize,
        end: endWindowResize,
      }}
      filesPanel={{
        ref: filesPanelRef,
        panel: { target: connectedTarget, cwd: activeCwd, openFileRequest: workspaceFileOpenRequest, onOpenFileRequestHandled: handleWorkspaceFileOpenHandled, onOpenFile: openWorkspaceFileTab },
      }}
      overlays={dialogHost}
    >

        <WorkspacePageContent
          page={activePage}
          settingsSection={settingsSection}
          onChangeSettingsSection={setSettingsSection}
          conversation={{
            thread: {
              id: activeThreadId,
              provider: threadProvider,
              providerName: threadProviderName,
              target: connectedTarget,
              targetLabel: formatWorkspaceTargetLabel(connectedTarget),
              cwd: activeCwd,
              entries,
              opening: openingThread,
              unfinishedResponse: activeThreadHasUnfinishedResponse,
              busy,
              busyElapsed,
              forkingEntryId,
            },
            tabs: {
              active: activeTab,
              activeSideChatId,
              rootThreadId: chatRootThreadId,
              mainThreadLabel,
              sideChats: visibleSideChats,
              terminal: terminalContext,
              files: workspaceFileTabs,
              activeFile: activeFileTab,
              createMenuOpen: tabCreateMenuOpen,
              createMenuPosition: tabCreateMenuPosition,
              createMenuRef: tabCreateMenuRef,
              createButtonRef: tabCreateButtonRef,
              creatingSideChat,
              creatingSession,
            },
            composer: {
              provider: threadProvider,
              providerName: threadProviderName,
              connectionState,
              activeThreadId,
              openingThread,
              busy,
              stoppingTurn,
              steeringPrompt,
              draft,
              onDraftChange: setDraft,
              onSendPrompt: () => { void sendPrompt(); },
              onStopTurn: () => { void stopTurn(); },
              notice,
              onClearNotice: () => setNotice(""),
              selectedSkill,
              onClearSelectedSkill: () => setSelectedSkill(null),
              slashMenuOpen,
              slashItems: visibleSlashItems,
              slashSkillIndex,
              onSlashSkillIndexChange: setSlashSkillIndex,
              slashSkillLoading,
              skillWarnings,
              skills,
              slashCommands,
              onChooseSlashMenuItem: chooseSlashMenuItem,
              imageAttachments,
              onAddImages: (files) => { void addImages(files); },
              onRemoveImage: removeImage,
              currentModel,
              selectedModel,
              displayedEffort,
              modelSettingsDialogOpen,
              onOpenModelSettings: () => setModelSettingsDialogOpen(true),
            },
            emptyState: { connectionState, providerName: assistantProviderName, creatingSession, notice },
            terminalPanel: terminalContext ? <TerminalPanel target={terminalContext.target} cwd={terminalContext.cwd} /> : null,
            actions: {
              setActiveTab,
              switchChatTab,
              closeSideChat,
              closeTerminalTab,
              closeFileTab: closeWorkspaceFileTab,
              toggleCreateMenu: toggleTabCreateMenu,
              closeCreateMenu: () => setTabCreateMenuOpen(false),
              createSideChat: () => { void createSideChat(); },
              openTerminalTab,
              openFile: openWorkspaceMarkdownFile,
              forkResponse: (entry) => { void forkCompletedResponse(entry); },
              openNewWorkspace: () => openNewSessionDialog("workspace"),
              openConnectionSettings: () => openSettings("connection"),
            },
          }}
          skills={{
            skills,
            visibleSkills,
            warnings: skillWarnings,
            connectionState,
            activeThreadId,
            selectedProvider: skillProvider,
            onProviderChange: setSkillProvider,
            filter,
            onFilterChange: setFilter,
            onOpenConnectionSettings: () => openSettings("connection"),
            onOpenSessions: () => setActivePage("sessions"),
            onUseSkill: (skill) => { setSelectedSkill(skill); setDraft(""); setActivePage("sessions"); },
          }}
          theme={{ theme, onToggleTheme: toggleTheme }}
          connection={{
            presentation: getConnectionPresentation(assistantProvider, isDaemonClient, assistantProviderName),
            providerName: assistantProviderName,
            providerOptions: availableProviders,
            daemonClient: isDaemonClient,
            provider: assistantProvider,
            target,
            workspaceHost: formatWorkspaceTargetLabel(connectedTarget || target) || "이 컴퓨터",
            connectionState,
            busy,
            notice,
            modelWarning,
            onProviderChange: (provider) => chooseProvider(provider, true),
            onTargetChange: setTarget,
            onConnect: () => {
              if (isDaemonClient) void connect(LOCAL_WORKSPACE_TARGET);
              else void connect();
            },
            onDisconnect: () => void disconnect(),
            onChangeDaemonSettings,
            onUseDirectConnection,
            onUseDaemonConnection,
          }}
        />
    </WorkspaceFrame>
  );
}
