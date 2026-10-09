import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider } from "../shared/bridge";
import type { SideChatTab } from "../shared/conversation-view";
import type { deriveWorkspaceViewModel } from "../features/workspace/workspace-view-model";
import type { useApprovalQueue } from "../features/conversation/useApprovalQueue";
import type { useActiveConversationState } from "../features/conversation/useActiveConversationState";
import type { useConversationEventPipeline } from "../features/conversation/useConversationEventPipeline";
import type { useConversationRuntime } from "../features/conversation/useConversationRuntime";
import type { useThreadViewStore } from "../features/conversation/useThreadViewStore";
import type { useWorkspaceConversationFeatures } from "./useWorkspaceConversationFeatures";
import type { useWorkspaceConnectionFeatures } from "./useWorkspaceConnectionFeatures";
import type { useConnectionState } from "../features/connection/useConnectionState";
import { useSessionLifecycleFeatures } from "../features/sessions/useSessionLifecycleFeatures";
import { useNewSessionDialog } from "../features/sessions/useNewSessionDialog";
import { useResponseFork } from "../features/sessions/useResponseFork";
import { useSideChatCreation } from "../features/sessions/useSideChatCreation";
import { useChatTabNavigation } from "../features/sessions/useChatTabNavigation";
import { useSessionSettings } from "../features/sessions/useSessionSettings";
import type { useSessionForkState } from "../features/sessions/useSessionForkState";
import type { useWorkspaceNavigation } from "../features/workspace/useWorkspaceNavigation";
import type { useWorkspaceTabs } from "../features/workspace/useWorkspaceTabs";

type WorkspaceSessionFeaturesOptions = {
  connectionUi: ReturnType<typeof useConnectionState>;
  conversationUi: ReturnType<typeof useActiveConversationState>;
  forkUi: ReturnType<typeof useSessionForkState>;
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  tabs: ReturnType<typeof useWorkspaceTabs>;
  threadViews: ReturnType<typeof useThreadViewStore>;
  runtime: ReturnType<typeof useConversationRuntime>;
  conversationFeatures: ReturnType<typeof useWorkspaceConversationFeatures>;
  connectionFeatures: ReturnType<typeof useWorkspaceConnectionFeatures>;
  conversationEvents: ReturnType<typeof useConversationEventPipeline>;
  view: {
    threadProvider: AssistantProvider;
    threadProviderName: string;
    chatRootThreadId: string;
    activeSideChat: SideChatTab | undefined;
    models: ReturnType<typeof deriveWorkspaceViewModel>["models"];
  };
  platform: { linuxDesktop: boolean; daemonClient: boolean };
  approvalQueue: ReturnType<typeof useApprovalQueue>;
  setNotice: Dispatch<SetStateAction<string>>;
};

/** Keep session lifecycle, fork tabs, and model settings within the sessions feature. */
export function useWorkspaceSessionFeatures({
  connectionUi,
  conversationUi,
  forkUi,
  navigation,
  tabs,
  threadViews,
  runtime,
  conversationFeatures,
  connectionFeatures,
  conversationEvents,
  view,
  platform,
  approvalQueue,
  setNotice,
}: WorkspaceSessionFeaturesOptions) {
  const { state: connection, setters: connectionSetters } = connectionUi;
  const { state: conversation, setters: conversationSetters } = conversationUi;
  const { state: fork, setters: forkSetters } = forkUi;
  const { setMobileSidebarOpen } = navigation;
  const { threadViewCacheLifecycle, activeThreadViewLifecycle } = conversationFeatures;

  const sessionDialog = useNewSessionDialog({ platform });

  const lifecycle = useSessionLifecycleFeatures({
    state: {
      connectedTarget: connection.connectedTarget,
      threadProvider: view.threadProvider,
      activeThreadId: conversation.activeThreadId,
      chatRootThreadId: view.chatRootThreadId,
      assistantProvider: connection.assistantProvider,
      connectedProvider: connection.connectedProvider,
    },
    setters: {
      setThreads: connectionSetters.setThreads,
      setSideChats: forkSetters.setSideChats,
      setActiveTitle: conversationSetters.setActiveTitle,
      setNotice,
      setProviderCatalogs: connectionSetters.setProviderCatalogs,
      setDraft: conversationSetters.setDraft,
      setMobileSidebarOpen,
      setBusy: conversationSetters.setBusy,
      setBusySince: conversationSetters.setBusySince,
      setApproval: approvalQueue.setApproval,
    },
    actions: {
      isThreadRunning: (target, provider, threadId) => runtime.isRunning(target, provider, threadId),
      removeThreadCache: (target, thread) => threadViewCacheLifecycle.removeThreadView(target, thread.provider, thread.id),
      updateCachedThreadTitle: threadViewCacheLifecycle.updateThreadTitle,
      clearActiveThreadAfterDeletion: activeThreadViewLifecycle.clearDeletedActiveThread,
      cacheActiveThreadView: () => threadViewCacheLifecycle.cacheActiveThreadView(),
      flushAssistantDeltas: conversationEvents.flushAssistantDeltas,
      activateThreadView: activeThreadViewLifecycle.activateThreadView,
      updateThreadEntries: conversationEvents.updateThreadEntries,
      connect: connectionFeatures.connect,
    },
  });

  const responseFork = useResponseFork({
    state: {
      connectedTarget: connection.connectedTarget,
      activeThreadId: conversation.activeThreadId,
      activeTitle: conversation.activeTitle,
      threadProvider: view.threadProvider,
      activeSideChat: view.activeSideChat,
      sideChats: fork.sideChats,
      busy: conversation.busy,
      openingThread: lifecycle.openingThread,
    },
    refs: { threadViews: threadViews.current },
    setters: {
      setThreads: connectionSetters.setThreads,
      setProviderCatalogs: connectionSetters.setProviderCatalogs,
      setSideChats: forkSetters.setSideChats,
      setActiveTab: tabs.setActiveTab,
      setMobileSidebarOpen,
      setNotice,
    },
    actions: {
      flushAssistantDeltas: conversationEvents.flushAssistantDeltas,
      cacheActiveThreadView: threadViewCacheLifecycle.cacheActiveThreadView,
      activateThreadView: activeThreadViewLifecycle.activateThreadView,
    },
  });

  const sideChatCreation = useSideChatCreation({
    state: {
      connectedTarget: connection.connectedTarget,
      activeThreadId: conversation.activeThreadId,
      threadProvider: view.threadProvider,
      activeSideChat: view.activeSideChat,
      sideChats: fork.sideChats,
      openingThread: lifecycle.openingThread,
    },
    refs: { threadViews: threadViews.current, runtime },
    setters: {
      setProviderCatalogs: connectionSetters.setProviderCatalogs,
      setSideChats: forkSetters.setSideChats,
      setDraft: conversationSetters.setDraft,
      setBusy: conversationSetters.setBusy,
      setActiveTurnId: conversationSetters.setActiveTurnId,
      setStoppingTurn: conversationSetters.setStoppingTurn,
      setBusySince: conversationSetters.setBusySince,
      setNotice,
    },
    actions: {
      flushAssistantDeltas: conversationEvents.flushAssistantDeltas,
      cacheActiveThreadView: threadViewCacheLifecycle.cacheActiveThreadView,
      activateThreadView: activeThreadViewLifecycle.activateThreadView,
      updateThreadEntries: conversationEvents.updateThreadEntries,
    },
  });

  const chatTabNavigation = useChatTabNavigation({
    state: {
      connectedTarget: connection.connectedTarget,
      activeThreadId: conversation.activeThreadId,
      threadProvider: view.threadProvider,
      activeTab: tabs.activeTab,
      threads: connection.threads,
    },
    refs: { threadViews: threadViews.current },
    setters: {
      setSideChats: forkSetters.setSideChats,
      setActiveSideChatId: forkSetters.setActiveSideChatId,
      setActiveTab: tabs.setActiveTab,
    },
    actions: {
      flushAssistantDeltas: conversationEvents.flushAssistantDeltas,
      cacheActiveThreadView: threadViewCacheLifecycle.cacheActiveThreadView,
      activateThreadView: activeThreadViewLifecycle.activateThreadView,
      openThread: lifecycle.openThread,
    },
  });

  const settings = useSessionSettings({
    state: {
      connectedTarget: connection.connectedTarget,
      activeThreadId: conversation.activeThreadId,
      provider: view.threadProvider,
      providerName: view.threadProviderName,
      currentModel: conversation.currentModel,
      currentEffort: conversation.currentEffort,
      models: view.models,
      modes: conversation.currentModes,
      permissionPresets: connection.providerCatalogs[view.threadProvider]?.permissionPresets ?? [],
    },
    refs: { threadViews: threadViews.current },
    setters: {
      setProviderCatalogs: connectionSetters.setProviderCatalogs,
      setCurrentModel: conversationSetters.setCurrentModel,
      setCurrentEffort: conversationSetters.setCurrentEffort,
      setCurrentPermissionProfile: conversationSetters.setCurrentPermissionProfile,
      setCurrentModeId: conversationSetters.setCurrentModeId,
      setNotice,
    },
  });

  return { lifecycle, sessionDialog, responseFork, sideChatCreation, chatTabNavigation, settings };
}
