import type { Dispatch, SetStateAction } from "react";
import type { PromptRecoveryControllerPort } from "../../../application/ports/prompt-recovery.js";
import type { DaemonApiRequestMap } from "../../../application/dto/daemon/daemon-api.js";
import type { AssistantProvider, TranscriptEntry } from "../../shared/bridge";
import type { ConversationRuntimePort } from "../../shared/conversation-store";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type StartSideChatPromptOptions = {
  target: string;
  provider: AssistantProvider;
  threadId: string;
  text: string;
  runtime: ConversationRuntimePort;
  promptRecovery: PromptRecoveryControllerPort<DaemonApiRequestMap["sendPrompt"]>;
  setters: {
    setDraft: StateSetter<string>;
    setBusy: StateSetter<boolean>;
    setActiveTurnId: StateSetter<string>;
    setStoppingTurn: StateSetter<boolean>;
    setBusySince: StateSetter<number | null>;
    setNotice: StateSetter<string>;
  };
  updateThreadEntries(
    target: string,
    provider: AssistantProvider,
    threadId: string,
    update: (current: TranscriptEntry[]) => TranscriptEntry[],
  ): void;
};

/** Start the initial prompt for a newly created side chat and recover local state if submission fails. */
export async function startSideChatPrompt({
  target,
  provider,
  threadId,
  text,
  runtime,
  promptRecovery,
  setters,
  updateThreadEntries,
}: StartSideChatPromptOptions): Promise<void> {
  const startedAt = Date.now();
  runtime.startThread(target, provider, threadId, startedAt);
  runtime.clearTurnId(target, provider, threadId);
  updateThreadEntries(target, provider, threadId, (current) => [
    ...current,
    { id: `local-${startedAt}`, role: "user", text },
  ]);
  setters.setBusy(true);
  setters.setActiveTurnId("");
  setters.setStoppingTurn(false);
  setters.setBusySince(startedAt);
  setters.setNotice("");
  try {
    const started = await promptRecovery.submit({ target, threadId, text, provider });
    if (started.turnId) {
      runtime.setTurnId(target, provider, threadId, started.turnId);
      if (runtime.isThreadSelected(target, provider, threadId)) {
        setters.setActiveTurnId(started.turnId);
      }
    }
  } catch (error) {
    const stillSelected = runtime.isThreadSelected(target, provider, threadId);
    if (!runtime.hasObservedTurnStart(target, provider, threadId)) {
      runtime.clearTurnTracking(target, provider, threadId);
      runtime.saveDraft(target, provider, threadId, text);
      if (stillSelected) {
        setters.setDraft(text);
        setters.setBusy(false);
        setters.setActiveTurnId("");
        setters.setBusySince(null);
      }
    }
    if (stillSelected) setters.setNotice(errorMessage(error));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
