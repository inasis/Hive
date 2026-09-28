import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import type { AppPage } from "../workspace/workspace-types";
import type { ConversationRuntime } from "./useConversationRuntime";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type HiveComposerCommandOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    threadProvider: AssistantProvider;
    threads: RemoteThread[];
  };
  refs: { runtime: ConversationRuntime };
  setters: {
    setDraft: StateSetter<string>;
    setNotice: StateSetter<string>;
    setFilter: StateSetter<string>;
    setActivePage: StateSetter<AppPage>;
  };
  actions: {
    disconnect(): Promise<void>;
    createSideChat(initialPrompt?: string): Promise<void>;
    openThread(target: string, thread: RemoteThread, sideChatId?: string): Promise<void>;
  };
};

/** Identify Hive-owned slash command names before provider command discovery. */
export function isHiveComposerCommandName(command: string): boolean {
  return /^(?:help|quit|exit|side|resume|skills)$/i.test(command);
}

/** Execute a Hive navigation or connection command; return false for provider prompts. */
export async function runHiveComposerCommand(text: string, options: HiveComposerCommandOptions): Promise<boolean> {
  const { state, refs, setters, actions } = options;
  if (text === "/help") {
    setters.setNotice("Hive 명령: /side [질문], /skills [검색어], /skill:<이름> [요청], /resume <세션 ID>, /quit. 그 밖의 입력은 현재 세션에 전달됩니다.");
    setters.setDraft("");
    return true;
  }
  if (text === "/quit" || text === "/exit") {
    setters.setDraft("");
    await actions.disconnect();
    return true;
  }
  const sideCommand = text.match(/^\/side(?:\s+([\s\S]*))?$/i);
  if (sideCommand) {
    refs.runtime.clearDraft(state.connectedTarget, state.threadProvider, state.activeThreadId);
    setters.setDraft("");
    await actions.createSideChat(sideCommand[1] ?? "");
    return true;
  }
  const resumeCommand = text.match(/^\/resume(?:\s+([A-Za-z0-9_-]{1,128}))?$/i);
  if (resumeCommand) {
    const requestedId = resumeCommand[1];
    const matches = requestedId ? state.threads.filter((thread) => thread.id === requestedId || thread.id.startsWith(requestedId)) : [];
    const match = matches.find((thread) => thread.provider === state.threadProvider) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!match) {
      setters.setNotice(requestedId
        ? "해당 ID와 일치하는 세션이 없습니다."
        : "왼쪽 세션 목록에서 이어갈 대화를 선택하거나 /resume <세션 ID>를 입력하세요.");
    } else {
      await actions.openThread(state.connectedTarget, match);
    }
    setters.setDraft("");
    return true;
  }
  if (/^\/skills(?:\s|$)/i.test(text)) {
    setters.setFilter(text.replace(/^\/skills\s*/i, ""));
    setters.setActivePage("skills");
    setters.setDraft("");
    return true;
  }
  return false;
}
