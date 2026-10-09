import type { AssistantProvider, RemoteModel, RemoteThread } from "../../shared/bridge";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import type { ConversationRuntimePort } from "../../shared/conversation-store";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { SideChatTab } from "../../shared/conversation-view";
import { providerDisplayName } from "../../shared/provider-display-name";

export function deriveWorkspaceViewModel(input: {
  assistantProvider: AssistantProvider;
  activeThreadProvider: AssistantProvider | null;
  connectedTarget: string;
  activeThreadId: string;
  providerCatalogs: ProviderCatalogs;
  sideChats: SideChatTab[];
  threads: RemoteThread[];
  busy: boolean;
  currentModel: string;
  currentEffort: string | null;
  runtime: ConversationRuntimePort;
  threadViews: ThreadViewStorePort;
}) {
  const {
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
    runtime,
    threadViews,
  } = input;
  const threadProvider = activeThreadProvider ?? assistantProvider;
  const activeModels = providerCatalogs[threadProvider];
  const models = activeModels?.models ?? [];
  const modelWarning = activeModels?.warning ?? "";
  const activeSideChat = sideChats.find((chat) => chat.target === connectedTarget && chat.provider === threadProvider && chat.threadId === activeThreadId);
  const chatRootThreadId = activeSideChat?.rootThreadId ?? activeThreadId;
  const visibleSideChats = sideChats.filter((chat) => chat.target === connectedTarget && chat.provider === threadProvider && chat.rootThreadId === chatRootThreadId);
  const activeThreadHasUnfinishedResponse = busy || Boolean(activeThreadId && runtime.isRunning(connectedTarget, threadProvider, activeThreadId));
  const mainThreadLabel = threads.find((thread) => thread.provider === threadProvider && thread.id === chatRootThreadId)?.title ??
    threadViews.get(connectedTarget, threadProvider, chatRootThreadId)?.title ?? "원본 대화";
  const selectedModel = models.find((model: RemoteModel) => model.model === currentModel);
  const reasoningOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const displayedEffort = currentEffort ?? selectedModel?.defaultReasoningEffort ?? "";

  return {
    threadProvider,
    threadProviderName: providerDisplayName(threadProvider),
    assistantProviderName: providerDisplayName(assistantProvider),
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
  };
}
