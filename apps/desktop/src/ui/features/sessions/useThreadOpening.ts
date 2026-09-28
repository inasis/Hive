import { useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import { bridgeRpc } from "../../bridgeClient";
import { providerDisplayName } from "../../shared/provider-display-name";
import { type ThreadView } from "../conversation/session-state";
import type { ProviderCatalogs } from "../connection/provider-catalog-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ThreadOpeningOptions = {
  state: {
    connectedTarget: string;
    assistantProvider: AssistantProvider;
    connectedProvider: AssistantProvider;
  };
  setters: {
    setProviderCatalogs: StateSetter<ProviderCatalogs>;
    setNotice: StateSetter<string>;
    setMobileSidebarOpen: StateSetter<boolean>;
  };
  actions: {
    cacheActiveThreadView(): void;
    flushAssistantDeltas(): void;
    activateThreadView(view: ThreadView, sideChatId?: string): void;
    connect(target: string, provider: AssistantProvider): Promise<boolean>;
  };
};

/** Reconnect to the selected provider when needed, hydrate its thread, and activate the view. */
export function useThreadOpening({ state, setters, actions }: ThreadOpeningOptions) {
  const [openingThread, setOpeningThread] = useState(false);

  const openThread = async (requestedTarget: string, thread: RemoteThread, sideChatId = ""): Promise<void> => {
    if (thread.provider !== state.assistantProvider || state.connectedProvider !== thread.provider) {
      const connected = await actions.connect(requestedTarget, thread.provider);
      if (!connected) return;
    } else {
      actions.cacheActiveThreadView();
    }
    setOpeningThread(true);
    setters.setNotice(`${providerDisplayName(thread.provider)} 대화 기록을 여는 중…`);
    try {
      const result = await bridgeRpc.request.openThread({ target: requestedTarget, threadId: thread.id, provider: thread.provider });
      if (result.models) {
        setters.setProviderCatalogs((current) => ({
          ...current,
          [thread.provider]: { ...current[thread.provider], models: result.models!, warning: result.modelWarning ?? "" },
        }));
      }
      actions.flushAssistantDeltas();
      const view: ThreadView = {
        target: requestedTarget,
        threadId: result.threadId,
        provider: thread.provider,
        title: result.title,
        cwd: result.cwd,
        model: result.model,
        effort: result.reasoningEffort,
        permissionProfile: result.permissionProfile,
        modes: result.modes ?? [],
        currentModeId: result.currentModeId ?? null,
        entries: result.entries,
        skills: result.skills,
        skillWarnings: result.skillWarnings,
      };
      actions.activateThreadView(view, sideChatId);
      setters.setMobileSidebarOpen(false);
    } catch (error) {
      const message = errorMessage(error);
      setters.setNotice(/already has an active writer/i.test(message)
        ? `이 세션은 다른 ${providerDisplayName(thread.provider)} 클라이언트에서 사용 중입니다. 기존 클라이언트에서 세션을 닫은 뒤 다시 여세요.`
        : message);
    } finally {
      setOpeningThread(false);
    }
  };

  return { openingThread, openThread };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
