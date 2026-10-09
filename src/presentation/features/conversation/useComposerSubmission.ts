import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteCommand, RemoteModel, RemoteSkill, RemoteThread, TranscriptEntry } from "../../shared/bridge";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import type { AppPage, SettingsSection } from "../../shared/workspace-state";
import type { LocalFileAttachment, LocalImageAttachment } from "../../shared/conversation-view";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { ConversationRuntimePort } from "../../shared/conversation-store";
import { isHiveComposerCommandName, runHiveComposerCommand } from "./hive-composer-commands";
import { executeProviderComposerCommand, resolveProviderComposerCommand } from "./provider-composer-commands";
import { submitComposerTurn } from "./submit-composer-turn";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";
import { readActiveAgentContext } from "../../shared/persona-profiles";

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
    fileAttachments: LocalFileAttachment[];
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
    threadViews: ThreadViewStorePort;
    runtime: ConversationRuntimePort;
  };
  setters: {
    setDraft: StateSetter<string>;
    setNotice: StateSetter<string>;
    setSlashCommands: StateSetter<RemoteCommand[]>;
    setModelSettingsDialogOpen: StateSetter<boolean>;
    setThreads: StateSetter<RemoteThread[]>;
    setImageAttachments: StateSetter<LocalImageAttachment[]>;
    setFileAttachments: StateSetter<LocalFileAttachment[]>;
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
      setSettingsSection: StateSetter<SettingsSection>;
    };
    actions: {
      disconnect(): Promise<void>;
      createSideChat(initialPrompt?: string): Promise<void>;
    };
  };
};

/** Route composer submissions to Hive commands, provider commands, or new provider turns. */
export function useComposerSubmission({ state, refs, setters, actions, hiveCommands }: ComposerSubmissionOptions) {
  const { bridge, promptRecovery } = useDesktopUiRuntime();
  const sendPrompt = async (inputText?: string): Promise<void> => {
    const pendingImages = assistantProviderSupports(state.threadProvider, "images") ? state.imageAttachments : [];
    const pendingFiles = assistantProviderSupports(state.threadProvider, "fileAttachments") ? state.fileAttachments : [];
    const text = (inputText ?? state.draft).trim() || (pendingImages.length ? "첨부한 이미지를 확인해 주세요." : pendingFiles.length ? "첨부한 파일을 확인해 주세요." : "");
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
      bridge.bridgeRpc,
      setters.setSlashCommands,
    );
    if ((pendingImages.length || pendingFiles.length) && typedCommand) {
      setters.setNotice(`첨부한 이미지와 파일은 ${state.threadProviderName} 일반 메시지에 보낼 수 있습니다. 먼저 슬래시 명령을 지우세요.`);
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
      bridgeRpc: bridge.bridgeRpc,
    })) return;

    await submitComposerTurn({
      target: state.connectedTarget,
      threadId: state.activeThreadId,
      provider: state.threadProvider,
      cwd: state.activeCwd,
      text,
      agentContext: readActiveAgentContext(bridge.preferences),
      skillId,
      images: pendingImages,
      files: pendingFiles,
      refs,
      setters,
      updateThreadEntries: actions.updateThreadEntries,
      promptRecovery,
    });
  };

  return { sendPrompt };
}
