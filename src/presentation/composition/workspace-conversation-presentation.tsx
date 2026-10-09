import { lazy, Suspense, type ComponentProps } from "react";
import { ConversationWorkspace } from "../features/conversation/ConversationWorkspace";
import { formatWorkspaceTargetLabel } from "../shared/workspace-target-label";
import type { WorkspacePagePresentationProps } from "./workspace-page-presentation-types";

const TerminalPanel = lazy(() => import("../features/workspace/TerminalPanel").then(({ TerminalPanel: component }) => ({ default: component })));

type WorkspaceConversationPresentationInput = Pick<
  WorkspacePagePresentationProps,
  | "daemons"
  | "connectionUi"
  | "conversationUi"
  | "forkUi"
  | "navigation"
  | "tabs"
  | "view"
  | "conversationFeatures"
  | "sessionFeatures"
  | "turnControls"
  | "composerSubmission"
  | "notice"
  | "setNotice"
>;

/** Map active workspace features to the conversation page's presentation contract. */
export function buildWorkspaceConversationPresentation({
  daemons,
  connectionUi,
  conversationUi,
  forkUi,
  navigation,
  tabs,
  view,
  conversationFeatures,
  sessionFeatures,
  turnControls,
  composerSubmission,
  notice,
  setNotice,
}: WorkspaceConversationPresentationInput): ComponentProps<typeof ConversationWorkspace> {
  const { state: connection } = connectionUi;
  const { state: conversation, setters: conversationSetters } = conversationUi;
  const { activeSideChatId } = forkUi.state;
  const { openSettings } = navigation;
  const {
    activeTab,
    setActiveTab,
    activeFileTab,
    terminalContext,
    terminalContexts,
    tabCreateMenuOpen,
    setTabCreateMenuOpen,
    tabCreateMenuPosition,
    tabCreateMenuRef,
    tabCreateButtonRef,
    toggleTabCreateMenu,
    workspaceFileTabs,
    openWorkspaceMarkdownFile,
    openTerminalTab,
    closeTerminalTab,
    closeWorkspaceFileTab,
  } = tabs;
  const {
    threadProvider,
    threadProviderName,
    assistantProviderName,
    chatRootThreadId,
    visibleSideChats,
    activeThreadHasUnfinishedResponse,
    mainThreadLabel,
    selectedModel,
    displayedEffort,
  } = view;
  const { imageAttachmentState, fileAttachmentState, slash } = conversationFeatures;
  const { attachments: imageAttachments, addImages, removeImage } = imageAttachmentState;
  const { attachments: fileAttachments, addFiles, removeFile } = fileAttachmentState;
  const { lifecycle, sessionDialog, responseFork, chatTabNavigation } = sessionFeatures;
  const { creatingSession, openingThread } = lifecycle;
  const { openNewSessionDialog } = sessionDialog;
  const { forkingEntryId, forkCompletedResponse } = responseFork;
  const { switchChatTab, closeSideChat } = chatTabNavigation;
  const { stopTurn } = turnControls;
  const { sendPrompt } = composerSubmission;

  return {
    thread: {
      id: conversation.activeThreadId,
      title: conversation.activeTitle,
      provider: threadProvider,
      providerName: threadProviderName,
      target: connection.connectedTarget,
      targetLabel: daemons.find((daemon) => daemon.target === connection.connectedTarget)?.hostname ?? formatWorkspaceTargetLabel(connection.connectedTarget),
      cwd: conversation.activeCwd,
      entries: conversation.entries,
      opening: openingThread,
      unfinishedResponse: activeThreadHasUnfinishedResponse,
      busy: conversation.busy,
      busyElapsed: conversation.busyElapsed,
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
      creatingSession,
    },
    composer: {
      provider: threadProvider,
      providerName: threadProviderName,
      connectionState: connection.connectionState,
      activeThreadId: conversation.activeThreadId,
      openingThread,
      busy: conversation.busy,
      stoppingTurn: conversation.stoppingTurn,
      steeringPrompt: conversation.steeringPrompt,
      draft: conversation.draft,
      onDraftChange: conversationSetters.setDraft,
      onSendPrompt: () => { void sendPrompt(); },
      onStopTurn: () => { void stopTurn(); },
      notice,
      onClearNotice: () => setNotice(""),
      selectedSkill: conversation.selectedSkill,
      onClearSelectedSkill: () => conversationSetters.setSelectedSkill(null),
      slashMenuOpen: slash.slashMenuOpen,
      slashItems: slash.visibleSlashItems,
      slashSkillIndex: slash.slashSkillIndex,
      onSlashSkillIndexChange: slash.setSlashSkillIndex,
      slashSkillLoading: slash.slashSkillLoading,
      skillWarnings: conversation.skillWarnings,
      skills: conversation.skills,
      slashCommands: conversation.slashCommands,
      onChooseSlashMenuItem: slash.chooseSlashMenuItem,
      imageAttachments,
      onAddImages: (files) => { void addImages(files); },
      onRemoveImage: removeImage,
      fileAttachments,
      onAddFiles: (files) => { void addFiles(files); },
      onRemoveFile: removeFile,
      currentModel: conversation.currentModel,
      selectedModel,
      displayedEffort,
      modelSettingsDialogOpen: conversation.modelSettingsDialogOpen,
      onOpenModelSettings: () => conversationSetters.setModelSettingsDialogOpen(true),
    },
    emptyState: { connectionState: connection.connectionState, providerName: assistantProviderName, creatingSession, notice },
    terminalPanel: terminalContexts.length ? <>{terminalContexts.map((context) => <div key={context.target} hidden={context.target !== connection.connectedTarget}><Suspense fallback={<div className="terminal-panel" role="status">터미널을 불러오는 중…</div>}><TerminalPanel target={context.target} cwd={context.cwd} /></Suspense></div>)}</> : null,
    actions: {
      setActiveTab,
      switchChatTab,
      closeSideChat,
      closeTerminalTab,
      closeFileTab: closeWorkspaceFileTab,
      toggleCreateMenu: toggleTabCreateMenu,
      closeCreateMenu: () => setTabCreateMenuOpen(false),
      openNewSession: () => openNewSessionDialog("session", conversation.activeCwd),
      renameSession: (provider, threadId, title) => lifecycle.openRenameSessionDialog({ id: threadId, provider, title }),
      openTerminalTab,
      openFile: openWorkspaceMarkdownFile,
      forkResponse: (entry) => { void forkCompletedResponse(entry); },
      openNewWorkspace: () => openNewSessionDialog("workspace"),
      openConnectionSettings: () => openSettings("connection"),
    },
  };
}
