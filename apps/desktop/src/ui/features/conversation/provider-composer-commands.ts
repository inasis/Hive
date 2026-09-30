import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteCommand, RemoteThread } from "../../../shared/bridge";
import { bridgeRpc } from "../../bridgeClient";
import { upsertProviderThreads } from "../../shared/provider-thread-state";
import type { ConversationRuntimePort } from "../../shared/conversation-store";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ProviderComposerCommandState = {
  connectedTarget: string;
  activeThreadId: string;
  activeCwd: string;
  threadProvider: AssistantProvider;
};

/** Resolve a provider slash command from the cached menu or current provider catalog. */
export async function resolveProviderComposerCommand(
  commandName: string | undefined,
  isHiveCommand: boolean,
  state: ProviderComposerCommandState & { slashCommands: RemoteCommand[] },
  runtime: Pick<ConversationRuntimePort, "isThreadSelected">,
  setSlashCommands: StateSetter<RemoteCommand[]>,
): Promise<RemoteCommand | null> {
  if (!commandName) return null;
  const cached = state.slashCommands.find((command) => command.name === commandName);
  if (cached) return cached;
  if (isHiveCommand) return null;
  try {
    const result = await bridgeRpc.request.listCommands({
      target: state.connectedTarget,
      threadId: state.activeThreadId,
      cwd: state.activeCwd,
      provider: state.threadProvider,
    });
    const command = result.commands.find((candidate) => candidate.name === commandName) ?? null;
    if (runtime.isThreadSelected(state.connectedTarget, state.threadProvider, state.activeThreadId)) {
      setSlashCommands(result.commands);
    }
    return command;
  } catch {
    // An unrecognized slash prefix remains an ordinary provider prompt.
    return null;
  }
}

/** Run a provider slash command and apply any resulting session update. */
export async function executeProviderComposerCommand(
  typedCommand: RegExpMatchArray | null,
  command: RemoteCommand | null,
  options: {
    state: ProviderComposerCommandState;
    setters: {
      setDraft: StateSetter<string>;
      setNotice: StateSetter<string>;
      setThreads: StateSetter<RemoteThread[]>;
    };
    actions: { openThread(target: string, thread: RemoteThread, sideChatId?: string): Promise<void> };
  },
): Promise<boolean> {
  if (!command || !typedCommand) return false;
  const { state, setters, actions } = options;
  setters.setDraft("");
  setters.setNotice("");
  try {
    const result = await bridgeRpc.request.runCommand({
      target: state.connectedTarget,
      threadId: state.activeThreadId,
      command: command.name,
      arguments: typedCommand[2] ?? "",
      cwd: state.activeCwd,
      provider: state.threadProvider,
    });
    if (result.thread) {
      setters.setThreads((current) => upsertProviderThreads(current, [result.thread!], state.threadProvider));
      await actions.openThread(state.connectedTarget, result.thread);
    }
    setters.setNotice(result.message ?? `/${command.name} 명령을 실행했습니다.`);
  } catch (error) {
    setters.setDraft(typedCommand[0]);
    setters.setNotice(errorMessage(error));
  }
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
