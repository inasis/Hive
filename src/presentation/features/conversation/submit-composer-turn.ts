import type { Dispatch, SetStateAction } from "react";
import type {
  AgentContextDto,
  AssistantProvider,
  PromptFileAttachment,
  PromptImageAttachment,
  RemoteSkill,
  TranscriptEntry,
} from "../../shared/bridge";
import type { PromptRecoveryControllerPort } from "../../../application/ports/prompt-recovery.js";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import type { DaemonApiRequestMap } from "../../../application/dto/daemon/daemon-api.js";
import type { ConversationRuntimePort, ThreadViewStorePort } from "../../shared/conversation-store";
import type { LocalFileAttachment, LocalImageAttachment } from "../../shared/conversation-view";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type ComposerTurnSubmission = {
  target: string;
  threadId: string;
  provider: AssistantProvider;
  cwd: string;
  text: string;
  agentContext: AgentContextDto | undefined;
  skillId: string | undefined;
  images: LocalImageAttachment[];
  files: LocalFileAttachment[];
  refs: {
    threadViews: ThreadViewStorePort;
    runtime: ConversationRuntimePort;
  };
  setters: {
    setDraft: StateSetter<string>;
    setNotice: StateSetter<string>;
    setImageAttachments: StateSetter<LocalImageAttachment[]>;
    setFileAttachments: StateSetter<LocalFileAttachment[]>;
    setBusy: StateSetter<boolean>;
    setActiveTurnId: StateSetter<string>;
    setStoppingTurn: StateSetter<boolean>;
    setSteeringPrompt: StateSetter<boolean>;
    setBusySince: StateSetter<number | null>;
    setSelectedSkill: StateSetter<RemoteSkill | null>;
  };
  updateThreadEntries(
    target: string,
    provider: AssistantProvider,
    threadId: string,
    update: (current: TranscriptEntry[]) => TranscriptEntry[],
  ): void;
  promptRecovery: PromptRecoveryControllerPort<DaemonApiRequestMap["sendPrompt"]>;
};

/** Own the optimistic transcript update and recovery rules for a composer turn submission. */
export async function submitComposerTurn({
  target,
  threadId,
  provider,
  cwd,
  text,
  agentContext,
  skillId,
  images,
  files,
  refs,
  setters,
  updateThreadEntries,
  promptRecovery,
}: ComposerTurnSubmission): Promise<void> {
  const promptImages: PromptImageAttachment[] = images.map(({ id: _id, ...image }) => image);
  const promptFiles: PromptFileAttachment[] = files.map(({ id: _id, ...file }) => file);
  const attachmentNotes = [
    ...(promptImages.length ? [`이미지 첨부: ${promptImages.map((image) => image.name).join(", ")}`] : []),
    ...(promptFiles.length ? [`파일 첨부: ${promptFiles.map((file) => file.name).join(", ")}`] : []),
  ];
  const displayText = attachmentNotes.length ? `${text}\n\n[${attachmentNotes.join(" · ")}]` : text;
  const startedAt = Date.now();
  refs.runtime.startThread(target, provider, threadId, startedAt);
  refs.runtime.clearTurnId(target, provider, threadId);
  updateThreadEntries(target, provider, threadId, (current) => [
    ...current,
    { id: `local-${startedAt}`, role: "user", text: displayText, createdAt: startedAt, ...(promptImages.length ? { images: promptImages } : {}) },
  ]);
  refs.runtime.clearDraft(target, provider, threadId);
  setters.setDraft("");
  setters.setBusy(true);
  setters.setActiveTurnId("");
  setters.setStoppingTurn(false);
  setters.setSteeringPrompt(false);
  setters.setBusySince(startedAt);
  setters.setNotice("");
  try {
    const promptRequest = {
      target,
      threadId,
      text,
      cwd,
      ...(agentContext ? { agentContext } : {}),
      ...(skillId ? { skillId } : {}),
      provider,
    };
    let started: Awaited<ReturnType<typeof promptRecovery.submit>>;
    if (promptImages.length && promptFiles.length &&
        assistantProviderSupports(provider, "images") && assistantProviderSupports(provider, "fileAttachments")) {
      started = await promptRecovery.submit({ ...promptRequest, provider, images: promptImages, files: promptFiles });
    } else if (promptFiles.length && assistantProviderSupports(provider, "fileAttachments")) {
      started = await promptRecovery.submit({ ...promptRequest, provider, files: promptFiles });
    } else if (promptImages.length && assistantProviderSupports(provider, "images")) {
      started = await promptRecovery.submit({ ...promptRequest, provider, images: promptImages });
    } else {
      started = await promptRecovery.submit(promptRequest);
    }
    if (promptImages.length || promptFiles.length) {
      if (promptImages.length) refs.threadViews.clearImageAttachments(target, provider, threadId);
      if (promptFiles.length) refs.threadViews.clearFileAttachments(target, provider, threadId);
      if (refs.runtime.isThreadSelected(target, provider, threadId)) {
        if (promptImages.length) setters.setImageAttachments([]);
        if (promptFiles.length) setters.setFileAttachments([]);
      }
    }
    if (skillId) setters.setSelectedSkill(null);
    if (started.turnId) {
      refs.runtime.setTurnId(target, provider, threadId, started.turnId);
      if (refs.runtime.isThreadSelected(target, provider, threadId)) setters.setActiveTurnId(started.turnId);
    }
  } catch (error) {
    const observed = refs.runtime.hasObservedTurnStart(target, provider, threadId);
    const stillSelected = refs.runtime.isThreadSelected(target, provider, threadId);
    if (observed && (promptImages.length || promptFiles.length)) {
      if (promptImages.length) refs.threadViews.clearImageAttachments(target, provider, threadId);
      if (promptFiles.length) refs.threadViews.clearFileAttachments(target, provider, threadId);
      if (stillSelected) {
        if (promptImages.length) setters.setImageAttachments([]);
        if (promptFiles.length) setters.setFileAttachments([]);
      }
    }
    if (!observed) {
      refs.runtime.clearTurnTracking(target, provider, threadId);
      refs.runtime.saveDraft(target, provider, threadId, text);
    }
    if (stillSelected) {
      if (observed) {
        setters.setNotice("응답을 작성하고 있습니다. 시작 확인이 지연됐지만 응답을 계속 받고 있습니다.");
      } else {
        setters.setDraft(text);
        setters.setBusy(false);
        setters.setActiveTurnId("");
        setters.setBusySince(null);
        setters.setNotice(errorMessage(error));
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
