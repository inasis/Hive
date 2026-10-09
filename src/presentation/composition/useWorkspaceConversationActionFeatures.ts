import type { useConversationRuntime } from "../features/conversation/useConversationRuntime";
import type { useThreadViewStore } from "../features/conversation/useThreadViewStore";
import type { WorkspacePagePresentationProps } from "./workspace-page-presentation-types";
import { useApprovalResponse } from "../features/conversation/useApprovalResponse";
import { useComposerSubmission } from "../features/conversation/useComposerSubmission";
import { useConversationTurnControls } from "../features/conversation/useConversationTurnControls";

type WorkspaceConversationActionFeaturesInput = Pick<
  WorkspacePagePresentationProps,
  | "approvalQueue"
  | "connectionFeatures"
  | "connectionUi"
  | "conversationFeatures"
  | "conversationUi"
  | "navigation"
  | "sessionFeatures"
  | "setNotice"
  | "skillsBrowser"
  | "view"
> & {
  threadViews: ReturnType<typeof useThreadViewStore>;
  runtime: ReturnType<typeof useConversationRuntime>;
};

/** Composes the workspace's turn, composer, and approval actions over shared feature state. */
export function useWorkspaceConversationActionFeatures(input: WorkspaceConversationActionFeaturesInput) {
  const {
    approvalQueue,
    connectionFeatures,
    connectionUi,
    conversationFeatures,
    conversationUi,
    navigation,
    sessionFeatures,
    setNotice,
    skillsBrowser,
    view,
    threadViews,
    runtime,
  } = input;
  const { connectedTarget, threads } = connectionUi.state;
  const {
    activeThreadId,
    activeCwd,
    currentModel,
    slashCommands,
    selectedSkill,
    draft,
    busy,
    activeTurnId,
    stoppingTurn,
    steeringPrompt,
  } = conversationUi.state;
  const {
    setModelSettingsDialogOpen,
    setSlashCommands,
    setSelectedSkill,
    setDraft,
    setBusy,
    setActiveTurnId,
    setStoppingTurn,
    setSteeringPrompt,
    setBusySince,
  } = conversationUi.setters;
  const { threadProvider, threadProviderName, models, modelWarning } = view;
  const { updateThreadEntries } = conversationFeatures.events;
  const { openThread } = sessionFeatures.lifecycle;
  const { createSideChat } = sessionFeatures.sideChatCreation;

  const turnControls = useConversationTurnControls({
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
    refs: { runtime },
    setters: {
      setDraft,
      setSteeringPrompt,
      setNotice,
      setStoppingTurn,
      setSelectedSkill,
    },
    actions: { updateThreadEntries },
  });
  const { steerPrompt } = turnControls;

  const composerSubmission = useComposerSubmission({
    state: {
      connectedTarget,
      activeThreadId,
      activeCwd,
      threadProvider,
      threadProviderName,
      draft,
      imageAttachments: conversationFeatures.imageAttachmentState.attachments,
      fileAttachments: conversationFeatures.fileAttachmentState.attachments,
      slashMenuOpen: conversationFeatures.slash.slashMenuOpen,
      slashSkillLoading: conversationFeatures.slash.slashSkillLoading,
      slashCommands,
      selectedSkill,
      busy,
      threads,
      currentModel,
      modelWarning,
      models,
    },
    refs: { threadViews: threadViews.current, runtime },
    setters: {
      setDraft,
      setNotice,
      setSlashCommands,
      setModelSettingsDialogOpen,
      setThreads: connectionUi.setters.setThreads,
      setImageAttachments: conversationFeatures.imageAttachmentState.setAttachments,
      setFileAttachments: conversationFeatures.fileAttachmentState.setAttachments,
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
      setters: {
        setFilter: skillsBrowser.setFilter,
        setActivePage: navigation.setActivePage,
        setSettingsSection: navigation.setSettingsSection,
      },
      actions: {
        disconnect: () => connectionFeatures.disconnect(),
        createSideChat,
      },
    },
  });

  const approvalResponse = useApprovalResponse({
    state: { connectedTarget, approval: approvalQueue.approval },
    setters: { setNotice, setApproval: approvalQueue.setApproval },
  });

  return { turnControls, composerSubmission, approvalResponse };
}
