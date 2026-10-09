import { useState } from "react";
import { WorkspaceFrame } from "../features/workspace/WorkspaceFrame";
import { useWorkspaceWindowFrame } from "../features/window/useWorkspaceWindowFrame";
import { RoleSpaceCreateDialog } from "../features/settings/RoleSpaceCreateDialog";
import { WorkspaceContentPresentation } from "./WorkspaceContentPresentation";
import { WorkspaceDialogPresentation } from "./WorkspaceDialogPresentation";
import type { WorkspacePagePresentationProps } from "./workspace-page-presentation-types";

/** Assemble the page shell around feature-specific content and dialog presenters. */
export function WorkspacePagePresentation(props: WorkspacePagePresentationProps) {
  const { isWindowsDesktop, externalActions, platform, daemons, personaProfiles, connectionUi, conversationUi, navigation, tabs, view, connectionFeatures, sessionFeatures, approvalQueue } = props;
  const [roleSpaceCreateDialogOpen, setRoleSpaceCreateDialogOpen] = useState(false);
  const { state: connection } = connectionUi;
  const { state: conversation } = conversationUi;
  const {
    activePage,
    settingsSection,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    desktopSidebarCollapsed,
    setDesktopSidebarCollapsed,
    navigate,
    openSettings,
  } = navigation;
  const {
    filePanelOpen,
    setFilePanelOpen,
    filePanelInitialized,
    workspaceFileOpenRequest,
    filesPanelRef,
    collapsedProjects,
    handleWorkspaceFileOpenHandled,
    openWorkspaceFileTab,
    toggleProject,
    toggleFilePanel,
  } = tabs;
  const { chatRootThreadId, assistantProviderName, threadProvider } = view;
  const { lifecycle, sessionDialog } = sessionFeatures;
  const {
    renameDialog,
    deleteDialog,
    creatingSession,
    openingThread,
    renamingSession,
    deletingSession,
    openThread,
    openRenameSessionDialog,
    openDeleteSessionDialog,
  } = lifecycle;
  const { dialog: newSessionDialog, openNewSessionDialog } = sessionDialog;
  const { approval } = approvalQueue;
  const { connect, refresh } = connectionFeatures;

  const { windowChrome, windowResize, sidebarControls: sidebarWindowControls } = useWorkspaceWindowFrame({
    isLinuxDesktop: platform.isLinuxDesktop,
    desktopSidebarCollapsed,
    theme: props.theme.theme,
    overlayOpen: newSessionDialog.open || Boolean(renameDialog) || Boolean(deleteDialog) || Boolean(approval) || roleSpaceCreateDialogOpen,
    onActivePage: navigation.setActivePage,
    onNotice: props.setNotice,
    onDetectedTheme: props.theme.setTheme,
  });

  const toggleSidebar = () => {
    if (platform.isMobileApp && !platform.isWideLayout) {
      const nextOpen = !mobileSidebarOpen;
      if (nextOpen) setFilePanelOpen(false);
      setMobileSidebarOpen(nextOpen);
      return;
    }
    setDesktopSidebarCollapsed((collapsed) => !collapsed);
  };

  const requestAddSpace = () => setRoleSpaceCreateDialogOpen(true);
  const confirmAddSpace = () => {
    personaProfiles.addSpace();
    setRoleSpaceCreateDialogOpen(false);
    navigate("role-space");
  };

  return <WorkspaceFrame
    layout={{ activePage, settingsSection, activeTitle: conversation.activeTitle, mobileSidebarOpen, desktopSidebarCollapsed, isMobileApp: platform.isMobileApp, isWindowsDesktop, isWideLayout: platform.isWideLayout, isLinuxDesktop: platform.isLinuxDesktop, filePanelOpen, filePanelInitialized }}
    actions={{
      toggleSidebar,
      dismissMobilePanels: () => { setMobileSidebarOpen(false); setFilePanelOpen(false); },
      toggleFilePanel,
    }}
    sidebar={{
      layout: { activePage, mobileSidebarOpen },
      provider: { assistantProvider: connection.assistantProvider, assistantProviderName, threadProvider, daemonClient: platform.isDaemonClient, connectionState: connection.connectionState },
      personas: personaProfiles.configuration,
      sessions: { daemons: platform.isDaemonClient ? daemons : [], threads: connection.threads, connectedTarget: connection.connectedTarget, chatRootThreadId, collapsedProjects, creatingSession, openingThread, renamingSession, deletingSession },
      gtk: sidebarWindowControls,
      actions: {
        openNewWorkspace: async (requestedTarget) => { if (requestedTarget && requestedTarget !== connection.connectedTarget && !await connect(requestedTarget)) return; navigate("sessions"); openNewSessionDialog("workspace"); },
        openNewSession: async (path, requestedTarget) => { if (requestedTarget && requestedTarget !== connection.connectedTarget && !await connect(requestedTarget)) return; navigate("sessions"); openNewSessionDialog("session", path); },
        refresh: () => { void refresh(); },
        openThread: (requestedTarget, thread) => { navigate("sessions"); void openThread(requestedTarget, thread); },
        openRenameSession: openRenameSessionDialog,
        selectDaemon: (target) => { void connect(target); },
        manageDaemons: externalActions.onChangeDaemonSettings,
        renameDaemon: externalActions.onRenameDaemon,
        openDeleteSession: openDeleteSessionDialog,
        toggleProject,
        navigate,
        selectSpace: (id) => { personaProfiles.selectSpace(id); navigate("role-space"); },
        selectPersona: (id) => { personaProfiles.selectProfile(id); navigate("persona"); },
        addSpace: requestAddSpace,
        addPersona: (spaceId) => { personaProfiles.addProfile(spaceId); navigate("persona"); },
        openSettings: () => openSettings(),
      },
    }}
    windowChrome={windowChrome}
    windowResize={windowResize}
    filesPanel={{
      ref: filesPanelRef,
      panel: { target: connection.connectedTarget, cwd: conversation.activeCwd, openFileRequest: workspaceFileOpenRequest, onOpenFileRequestHandled: handleWorkspaceFileOpenHandled, onOpenFile: openWorkspaceFileTab },
    }}
    overlays={<>
      <WorkspaceDialogPresentation {...props} />
      <RoleSpaceCreateDialog open={roleSpaceCreateDialogOpen} onCancel={() => setRoleSpaceCreateDialogOpen(false)} onConfirm={confirmAddSpace} />
    </>}
  >
    <WorkspaceContentPresentation {...props} personaProfiles={{ ...personaProfiles, addSpace: requestAddSpace }} />
  </WorkspaceFrame>;
}
