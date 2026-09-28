import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, PromptImageAttachment, RemoteCommand, RemoteModel, RemoteSkill, RemoteThread, TranscriptEntry } from "../../../shared/bridge";
import { assistantProviderSupports } from "../../../../../../src/domain/provider-catalog.js";
import { bridgeRpc } from "../../bridgeClient";
import type { AppPage } from "../workspace/workspace-types";
import type { LocalImageAttachment } from "./session-state";
import type { ThreadViewStore } from "./thread-view-store";
import type { ConversationRuntime } from "./useConversationRuntime";
import { isHiveComposerCommandName, runHiveComposerCommand } from "./hive-composer-commands";
import { executeProviderComposerCommand, resolveProviderComposerCommand } from "./provider-composer-commands";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ComposerSubmissionOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    activeCwd: string;
    threadProvider: AssistantProvider;
    threadProviderName: string;
    draft: string;
    imageAttachments: LocalImageAttachment[];
    slashMenuOpen: boolean;
    slashSkillLoading: boolean;
    slashCommands: RemoteCommand[];
    selectedSkill: RemoteSkill | null;
    busy: boolean;
    threads: RemoteThread[];
    currentModel: string;
    modelWarning: string;
    models: RemoteModel[];
  };
  refs: {
    threadViews: ThreadViewStore;
    runtime: ConversationRuntime;
  };
  setters: {
    setDraft: StateSetter<string>;
    setNotice: StateSetter<string>;
    setSlashCommands: StateSetter<RemoteCommand[]>;
    setModelSettingsDialogOpen: StateSetter<boolean>;
    setThreads: StateSetter<RemoteThread[]>;
    setImageAttachments: StateSetter<LocalImageAttachment[]>;
    setBusy: StateSetter<boolean>;
    setActiveTurnId: StateSetter<string>;
    setStoppingTurn: StateSetter<boolean>;
    setSteeringPrompt: StateSetter<boolean>;
    setBusySince: StateSetter<number | null>;
    setSelectedSkill: StateSetter<RemoteSkill | null>;
  };
  actions: {
    openThread(target: string, thread: RemoteThread, sideChatId?: string): Promise<void>;
    steerPrompt(text: string, skillId?: string): Promise<void>;
    updateThreadEntries(target: string, provider: AssistantProvider, threadId: string, update: (current: TranscriptEntry[]) => TranscriptEntry[]): void;
  };
  hiveCommands: {
    setters: {
      setFilter: StateSetter<string>;
      setActivePage: StateSetter<AppPage>;
    };
    actions: {
      disconnect(): Promise<void>;
      createSideChat(initialPrompt?: string): Promise<void>;
    };
  };
};

/** Route composer submissions to Hive commands, provider commands, or new provider turns. */
export function useComposerSubmission({ state, refs, setters, actions, hiveCommands }: ComposerSubmissionOptions) {
  const sendPrompt = async (inputText?: string): Promise<void> => {
    const pendingImages = assistantProviderSupports(state.threadProvider, "images") ? state.imageAttachments : [];
    const text = (inputText ?? state.draft).trim() || (pendingImages.length ? "첨부한 이미지를 확인해 주세요." : "");
    if (!text || !state.connectedTarget || !state.activeThreadId) return;
    if (state.slashMenuOpen && state.slashSkillLoading) return;
    const typedCommand = text.match(/^\/([A-Za-z0-9._/-]+)(?:\s+([\s\S]*))?$/);
    const commandName = typedCommand?.[1];
    const isHiveCommand = commandName ? isHiveComposerCommandName(commandName) : false;
    const matchedSlashCommand = await resolveProviderComposerCommand(
      commandName,
      isHiveCommand,
      state,
      refs.runtime,
      setters.setSlashCommands,
    );
    if (pendingImages.length && typedCommand) {
      setters.setNotice(`이미지는 ${state.threadProviderName} 일반 메시지에 첨부할 수 있습니다. 먼저 슬래시 명령을 지우세요.`);
      return;
    }
    const skillId = matchedSlashCommand ? undefined : state.selectedSkill?.id;
    if (state.busy) {
      if (matchedSlashCommand) {
        setters.setNotice("명령은 현재 응답이 끝난 뒤 실행하세요.");
        return;
      }
      if (!assistantProviderSupports(state.threadProvider, "turnSteering")) {
        setters.setNotice(`${state.threadProviderName}은(는) 응답 중 추가 메시지 전달을 지원하지 않습니다. 응답을 중지하거나 끝날 때까지 기다려 주세요.`);
        return;
      }
      await actions.steerPrompt(text, skillId);
      return;
    }
    if (await runHiveComposerCommand(text, {
      state,
      refs,
      setters: { ...setters, ...hiveCommands.setters },
      actions: { ...hiveCommands.actions, openThread: actions.openThread },
    })) return;
    if (assistantProviderSupports(state.threadProvider, "requiresModelBeforePrompt") && !state.currentModel.trim()) {
      setters.setNotice(state.models.some((model) => !model.hidden)
        ? `${state.threadProviderName} 모델을 선택한 뒤 메시지를 보내세요.`
        : state.modelWarning || `${state.threadProviderName}에서 선택할 수 있는 모델이 없습니다.`);
      setters.setModelSettingsDialogOpen(true);
      return;
    }
    if (await executeProviderComposerCommand(typedCommand, matchedSlashCommand, {
      state,
      setters,
      actions: { openThread: actions.openThread },
    })) return;

    const promptTarget = state.connectedTarget;
    const promptThreadId = state.activeThreadId;
    const promptProvider = state.threadProvider;
    const promptImages: PromptImageAttachment[] = pendingImages.map(({ id: _id, ...image }) => image);
    const displayText = promptImages.length
      ? `${text}\n\n[이미지 첨부: ${promptImages.map((image) => image.name).join(", ")}]`
      : text;
    const startedAt = Date.now();
    refs.runtime.startThread(promptTarget, promptProvider, promptThreadId, startedAt);
    refs.runtime.clearTurnId(promptTarget, promptProvider, promptThreadId);
    actions.updateThreadEntries(promptTarget, promptProvider, promptThreadId, (current) => [
      ...current,
      { id: `local-${startedAt}`, role: "user", text: displayText, ...(promptImages.length ? { images: promptImages } : {}) },
    ]);
    refs.runtime.clearDraft(promptTarget, promptProvider, promptThreadId);
    setters.setDraft("");
    setters.setBusy(true);
    setters.setActiveTurnId("");
    setters.setStoppingTurn(false);
    setters.setSteeringPrompt(false);
    setters.setBusySince(startedAt);
    setters.setNotice("");
    try {
      const started = await bridgeRpc.request.sendPrompt({
        target: promptTarget,
        threadId: promptThreadId,
        text,
        cwd: state.activeCwd,
        ...(skillId ? { skillId } : {}),
        ...(promptImages.length ? { images: promptImages } : {}),
        provider: promptProvider,
      });
      if (promptImages.length) {
        refs.threadViews.clearImageAttachments(promptTarget, promptProvider, promptThreadId);
        if (refs.runtime.isThreadSelected(promptTarget, promptProvider, promptThreadId)) setters.setImageAttachments([]);
      }
      if (skillId) setters.setSelectedSkill(null);
      if (started.turnId) {
        refs.runtime.setTurnId(promptTarget, promptProvider, promptThreadId, started.turnId);
        if (refs.runtime.isThreadSelected(promptTarget, promptProvider, promptThreadId)) setters.setActiveTurnId(started.turnId);
      }
    } catch (error) {
      const observed = refs.runtime.hasObservedTurnStart(promptTarget, promptProvider, promptThreadId);
      const stillSelected = refs.runtime.isThreadSelected(promptTarget, promptProvider, promptThreadId);
      if (observed && promptImages.length) {
        refs.threadViews.clearImageAttachments(promptTarget, promptProvider, promptThreadId);
        if (stillSelected) setters.setImageAttachments([]);
      }
      if (!observed) {
        refs.runtime.clearTurnTracking(promptTarget, promptProvider, promptThreadId);
      }
      if (stillSelected) {
        if (observed) {
          setters.setNotice(`${state.threadProviderName}가 응답 중입니다. 시작 확인이 지연됐지만 응답을 계속 받고 있습니다.`);
        } else {
          setters.setBusy(false);
          setters.setActiveTurnId("");
          setters.setBusySince(null);
          setters.setNotice(errorMessage(error));
        }
      }
    }
  };

  return { sendPrompt };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
