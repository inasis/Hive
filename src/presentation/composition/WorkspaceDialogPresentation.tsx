import { AppDialogHost } from "../features/sessions/AppDialogHost";
import type { WorkspacePagePresentationProps } from "./workspace-page-presentation-types";

/** Map session feature state to the modal host contract. */
export function WorkspaceDialogPresentation({
  platform,
  daemons,
  connectionUi,
  conversationUi,
  view,
  sessionFeatures,
  approvalQueue,
  connectionFeatures,
  approvalResponse,
}: WorkspacePagePresentationProps) {
  const { state: connection } = connectionUi;
  const { state: conversation, setters: conversationSetters } = conversationUi;
  const { threadProvider, threadProviderName, assistantProviderName, models, modelWarning, selectedModel, reasoningOptions, displayedEffort } = view;
  const { lifecycle, sessionDialog, settings } = sessionFeatures;
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
    saveSessionName,
    deleteSession,
    creatingSession,
    createSessionInWorkspace,
  } = lifecycle;
  const { dialog: newSessionDialog } = sessionDialog;
  const { updatingSettings, updateSettings, changeModel } = settings;
  const { approval } = approvalQueue;
  const { answerApproval } = approvalResponse;
  const { chooseProvider } = connectionFeatures;

  const submitNewSession = async () => {
    const result = await createSessionInWorkspace({
      cwd: newSessionDialog.path,
      name: newSessionDialog.name,
      permissionPresets: newSessionDialog.permissionPresets,
    });
    if (result.kind === "created") sessionDialog.finishCreation();
    else if (result.kind === "invalid" || result.kind === "failed") sessionDialog.showCreationError(result.message);
  };

  return <AppDialogHost
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
        busy: conversation.busy,
      },
      provider: {
        current: connection.assistantProvider,
        name: assistantProviderName,
        options: connection.availableProviders,
        permissionPresets: connection.providerCatalogs[connection.assistantProvider]?.permissionPresets ?? [],
        connectionState: connection.connectionState,
        connectedProvider: connection.connectedProvider,
      },
      platform: { linuxDesktop: platform.isLinuxDesktop, daemonClient: platform.isDaemonClient },
      actions: {
        close: sessionDialog.closeNewSessionDialog,
        submit: () => void submitNewSession(),
        chooseProvider: (next) => chooseProvider(next, true),
        changePath: sessionDialog.changePath,
        changeName: sessionDialog.changeName,
        changePermissionPresets: sessionDialog.changePermissionPresets,
        chooseWorkspaceFolder: () => void sessionDialog.chooseWorkspaceFolder(),
      },
    }}
    sessions={{
      model: {
        open: conversation.modelSettingsDialogOpen,
        threadId: conversation.activeThreadId,
        provider: threadProvider,
        providerName: threadProviderName,
        currentModel: conversation.currentModel,
        models,
        permissionPresets: connection.providerCatalogs[threadProvider]?.permissionPresets ?? [],
        selectedModel,
        warning: modelWarning,
        updating: updatingSettings,
        busy: conversation.busy,
        displayedEffort,
        reasoningOptions,
        modes: conversation.currentModes,
        currentModeId: conversation.currentModeId,
        permissionProfile: conversation.currentPermissionProfile,
      },
      modelActions: {
        close: () => conversationSetters.setModelSettingsDialogOpen(false),
        update: (change) => void updateSettings(change),
        changeModel,
      },
      rename: { draft: renameDialog, name: renameSessionName, error: renameSessionError, saving: renamingSession, providerName: assistantProviderName },
      renameActions: {
        close: () => setRenameDialog(null),
        changeName: (value) => { setRenameSessionName(value); setRenameSessionError(""); },
        save: () => void saveSessionName(),
      },
      approval: approval ? { ...approval, hostname: daemons.find((daemon) => daemon.target === approval.target)?.hostname } : null,
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
}
