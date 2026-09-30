import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteSkill, TranscriptEntry } from "../../../shared/bridge";
import { assistantProviderSupports } from "../../../../../../src/domain/provider-catalog.js";
import { bridgeRpc } from "../../bridgeClient";
import type { ConversationRuntimePort } from "../../shared/conversation-store";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ConversationTurnControlsOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    activeCwd: string;
    threadProvider: AssistantProvider;
    threadProviderName: string;
    busy: boolean;
    steeringPrompt: boolean;
    stoppingTurn: boolean;
    activeTurnId: string;
  };
  refs: { runtime: ConversationRuntimePort };
  setters: {
    setDraft: StateSetter<string>;
    setSteeringPrompt: StateSetter<boolean>;
    setNotice: StateSetter<string>;
    setSelectedSkill: StateSetter<RemoteSkill | null>;
    setStoppingTurn: StateSetter<boolean>;
  };
  actions: {
    updateThreadEntries(target: string, provider: AssistantProvider, threadId: string, update: (current: TranscriptEntry[]) => TranscriptEntry[]): void;
  };
};

/** Own actions that change or interrupt an already running conversation turn. */
export function useConversationTurnControls({ state, refs, setters, actions }: ConversationTurnControlsOptions) {
  const steerPrompt = async (text: string, skillId?: string): Promise<void> => {
    if (!state.connectedTarget || !state.activeThreadId || !state.busy || state.steeringPrompt || state.stoppingTurn) return;
    const promptProvider = state.threadProvider;
    if (!assistantProviderSupports(promptProvider, "turnSteering")) {
      setters.setNotice(`${state.threadProviderName}은(는) 응답 중 추가 메시지 전달을 지원하지 않습니다. 응답을 중지하거나 끝날 때까지 기다려 주세요.`);
      return;
    }
    const promptTarget = state.connectedTarget;
    const promptThreadId = state.activeThreadId;
    refs.runtime.clearDraft(promptTarget, promptProvider, promptThreadId);
    setters.setDraft("");
    setters.setSteeringPrompt(true);
    setters.setNotice("");
    let turnId = refs.runtime.turnId(promptTarget, promptProvider, promptThreadId) ??
      (refs.runtime.isThreadSelected(promptTarget, promptProvider, promptThreadId) ? state.activeTurnId : "");
    for (let attempt = 0; !turnId && attempt < 50 && refs.runtime.isRunning(promptTarget, promptProvider, promptThreadId); attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      turnId = refs.runtime.turnId(promptTarget, promptProvider, promptThreadId) ?? "";
    }
    if (!turnId) {
      const stillSelected = refs.runtime.isThreadSelected(promptTarget, promptProvider, promptThreadId);
      if (stillSelected) setters.setDraft((current) => current.trim() ? current : text);
      else refs.runtime.saveDraft(promptTarget, promptProvider, promptThreadId, text);
      if (stillSelected) setters.setNotice(`${state.threadProviderName} 작업 시작을 확인하는 중입니다. 잠시 뒤 다시 보내 주세요.`);
      setters.setSteeringPrompt(false);
      return;
    }

    try {
      const result = await bridgeRpc.request.steerTurn({
        target: promptTarget,
        threadId: promptThreadId,
        turnId,
        text,
        cwd: state.activeCwd,
        ...(skillId ? { skillId } : {}),
        provider: promptProvider,
      });
      const acceptedTurnId = result.turnId || turnId;
      refs.runtime.setTurnId(promptTarget, promptProvider, promptThreadId, acceptedTurnId);
      const stillSelected = refs.runtime.isThreadSelected(promptTarget, promptProvider, promptThreadId);
      actions.updateThreadEntries(promptTarget, promptProvider, promptThreadId, (current) => [...current, {
        id: `local-steer-${acceptedTurnId}-${Date.now()}`,
        role: "user",
        text,
      }]);
      if (skillId) setters.setSelectedSkill(null);
      if (stillSelected) setters.setNotice(`현재 ${state.threadProviderName} 작업에 메시지를 전달했습니다. 다음 처리 단계부터 반영됩니다.`);
    } catch (error) {
      const stillSelected = refs.runtime.isThreadSelected(promptTarget, promptProvider, promptThreadId);
      if (stillSelected) setters.setDraft((current) => current.trim() ? current : text);
      else refs.runtime.saveDraft(promptTarget, promptProvider, promptThreadId, text);
      if (stillSelected) setters.setNotice(errorMessage(error));
    } finally {
      setters.setSteeringPrompt(false);
    }
  };

  const stopTurn = async (): Promise<void> => {
    if (!state.connectedTarget || !state.activeThreadId || !state.busy || state.stoppingTurn) return;
    const target = state.connectedTarget;
    const threadId = state.activeThreadId;
    const provider = state.threadProvider;
    let turnId = refs.runtime.turnId(target, provider, threadId) ?? state.activeTurnId;
    for (let attempt = 0; !turnId && attempt < 50 && refs.runtime.isRunning(target, provider, threadId); attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      turnId = refs.runtime.turnId(target, provider, threadId) ?? "";
    }
    if (!turnId) {
      setters.setNotice(`${state.threadProviderName} 작업 시작을 확인하는 중입니다. 잠시 뒤 다시 눌러 주세요.`);
      return;
    }

    refs.runtime.markInterrupted(target, provider, threadId);
    setters.setStoppingTurn(true);
    setters.setNotice(`${state.threadProviderName} 작업을 중지하는 중…`);
    try {
      await bridgeRpc.request.interruptTurn({ target, threadId, turnId, provider });
      if (refs.runtime.isThreadSelected(target, provider, threadId)) {
        setters.setNotice(`${state.threadProviderName} 작업 중지 요청을 보냈습니다.`);
      }
    } catch (error) {
      refs.runtime.clearInterrupted(target, provider, threadId);
      if (refs.runtime.isThreadSelected(target, provider, threadId)) {
        setters.setStoppingTurn(false);
        setters.setNotice(errorMessage(error));
      }
    }
  };

  return { steerPrompt, stopTurn };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
