import type { AssistantProvider, RemoteSkill, TranscriptEntry, RemoteMode } from "../../shared/bridge";
import type { LocalFileAttachment, LocalImageAttachment, ThreadView } from "../../shared/conversation-view";
import type { ThreadViewStorePort, ConversationRuntimePort } from "../../shared/conversation-store";
import { useTranscriptCache } from "../../shared/transcript-cache-context";

export type ThreadViewCacheLifecycleOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    activeThreadProvider: AssistantProvider | null;
    assistantProvider: AssistantProvider;
    draft: string;
    imageAttachments: LocalImageAttachment[];
    fileAttachments: LocalFileAttachment[];
    activeTitle: string;
    activeCwd: string;
    currentModel: string;
    currentEffort: string | null;
    currentPermissionProfile: string | null;
    currentModes: RemoteMode[];
    currentModeId: string | null;
    entries: TranscriptEntry[];
    skills: RemoteSkill[];
    skillWarnings: string[];
  };
  refs: {
    threadViews: ThreadViewStorePort;
    runtime: ConversationRuntimePort;
  };
  actions: {
    clearThreadDeltas(target: string, provider: AssistantProvider, threadId: string): void;
  };
};

/** Own cached thread-view writes and cleanup across session lifecycle transitions. */
export function useThreadViewCacheLifecycle({ state, refs, actions }: ThreadViewCacheLifecycleOptions) {
  const transcriptCache = useTranscriptCache();

  const cacheActiveThreadView = (saveDraft = true, provider = state.activeThreadProvider ?? state.assistantProvider): void => {
    if (!state.connectedTarget || !state.activeThreadId) return;
    if (saveDraft) refs.runtime.saveDraft(state.connectedTarget, provider, state.activeThreadId, state.draft);
    refs.threadViews.setImageAttachments(state.connectedTarget, provider, state.activeThreadId, state.imageAttachments);
    refs.threadViews.setFileAttachments(state.connectedTarget, provider, state.activeThreadId, state.fileAttachments);
    const previous = refs.threadViews.get(state.connectedTarget, provider, state.activeThreadId);
    refs.threadViews.set({
      target: state.connectedTarget,
      threadId: state.activeThreadId,
      provider,
      title: state.activeTitle,
      cwd: state.activeCwd,
      model: state.currentModel,
      effort: state.currentEffort,
      permissionProfile: state.currentPermissionProfile,
      modes: state.currentModes,
      currentModeId: state.currentModeId,
      entries: previous?.entries ?? state.entries,
      skills: state.skills,
      skillWarnings: state.skillWarnings,
    });
  };

  const removeThreadView = (target: string, provider: AssistantProvider, threadId: string): void => {
    refs.threadViews.delete(target, provider, threadId);
    void transcriptCache.delete(target, provider, threadId);
    refs.runtime.clearThread(target, provider, threadId);
    actions.clearThreadDeltas(target, provider, threadId);
  };

  const updateThreadTitle = (target: string, provider: AssistantProvider, threadId: string, title: string): void => {
    refs.threadViews.update(target, provider, threadId, (view: ThreadView) => ({ ...view, title }));
  };

  return { cacheActiveThreadView, removeThreadView, updateThreadTitle };
}
