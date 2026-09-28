import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ASSISTANT_PROVIDERS } from "../../../../../../src/domain/provider-catalog.js";
import { LOCAL_WORKSPACE_TARGET, type AssistantProvider, type RemoteThread } from "../../../shared/bridge";
import { replaceProviderThreads } from "../conversation/session-state";
import { providerDisplayName } from "../../shared/provider-display-name";
import { bridgeRpc, preferences, setAssistantProvider } from "../../bridgeClient";
import { PREFERENCE_KEYS } from "../../../shared/preferences";
import type { AppPage } from "../workspace/workspace-types";
import type { BridgeConnectionState } from "./connection-state";
import type { ProviderCatalogs } from "./provider-catalog-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ConnectionWorkflowOptions = {
  state: {
    assistantProvider: AssistantProvider;
    target: string;
    connectedTarget: string;
    connectedProvider: AssistantProvider;
    activeThreadId: string;
    activeThreadProvider: AssistantProvider | null;
    connectionState: BridgeConnectionState;
    busy: boolean;
    threads: RemoteThread[];
    isDaemonClient: boolean;
    isMobileApp: boolean;
  };
  setters: {
    setAssistantProvider: StateSetter<AssistantProvider>;
    setTarget: StateSetter<string>;
    setConnectedTarget: StateSetter<string>;
    setConnectedProvider: StateSetter<AssistantProvider>;
    setConnectionState: StateSetter<BridgeConnectionState>;
    setNotice: StateSetter<string>;
    setThreads: StateSetter<RemoteThread[]>;
    setProviderCatalogs: StateSetter<ProviderCatalogs>;
    setActivePage: StateSetter<AppPage>;
    setMobileSidebarOpen: StateSetter<boolean>;
  };
  actions: {
    cacheActiveThreadView(saveDraft: boolean, provider: AssistantProvider): void;
    resetWorkspace(provider: AssistantProvider): void;
    resetProviderThreadView(provider: AssistantProvider): void;
    clearConnectionState(provider: AssistantProvider): void;
    loadAdditionalProviderThreads(target: string, selectedProvider: AssistantProvider): void;
    openConnectionSettings(): void;
  };
};

/** Own provider connection, switch, and refresh workflows for the desktop and mobile UI. */
export function useConnectionWorkflow({ state, setters, actions }: ConnectionWorkflowOptions) {
  const connectSequence = useRef(0);

  const connect = async (targetOverride?: string, providerOverride?: AssistantProvider): Promise<boolean> => {
    const sequence = ++connectSequence.current;
    const selectedProvider = providerOverride ?? state.assistantProvider;
    const requestedTarget = (targetOverride ?? state.target).trim() || LOCAL_WORKSPACE_TARGET;

    const sameTargetProviderSwitch = state.connectedTarget === requestedTarget && state.connectedProvider !== selectedProvider;
    if (state.activeThreadId && state.connectedTarget) {
      actions.cacheActiveThreadView(true, state.activeThreadProvider ?? state.connectedProvider);
    }
    setters.setAssistantProvider(selectedProvider);
    setAssistantProvider(selectedProvider);
    setters.setConnectionState("connecting");
    setters.setNotice(`${providerDisplayName(selectedProvider)}로 연결하는 중…`);

    try {
      if (state.connectedTarget && (state.connectedTarget !== requestedTarget || state.connectedProvider !== selectedProvider)) {
        if (!sameTargetProviderSwitch) {
          await disconnectProviderSessions(state.connectedTarget);
          if (sequence !== connectSequence.current) return false;
          actions.resetWorkspace(selectedProvider);
        }
      }

      const result = await bridgeRpc.request.connect({ target: requestedTarget, provider: selectedProvider });
      if (sequence !== connectSequence.current) return false;
      if (!state.isDaemonClient && requestedTarget !== LOCAL_WORKSPACE_TARGET) {
        preferences.setItem(PREFERENCE_KEYS.sshTarget, requestedTarget);
      }
      setters.setTarget(requestedTarget);
      setters.setConnectedTarget(requestedTarget);
      setters.setConnectedProvider(selectedProvider);

      if (sameTargetProviderSwitch) actions.resetProviderThreadView(selectedProvider);

      setters.setThreads((current) => requestedTarget === state.connectedTarget
        ? replaceProviderThreads(current, result.threads, selectedProvider)
        : replaceProviderThreads([], result.threads, selectedProvider));
      setters.setProviderCatalogs((current) => ({
        ...current,
        [selectedProvider]: { models: result.models, warning: result.modelWarning ?? "", permissionPresets: result.permissionPresets ?? [] },
      }));
      setters.setConnectionState("connected");
      setters.setActivePage("sessions");
      if (state.isMobileApp) setters.setMobileSidebarOpen(true);
      setters.setNotice(`${providerDisplayName(selectedProvider)} 연결됨 · 세션 ${result.threads.length}개. 왼쪽에서 이어갈 세션을 선택하세요.`);
      actions.loadAdditionalProviderThreads(requestedTarget, selectedProvider);
      return true;
    } catch (error) {
      if (sequence !== connectSequence.current) return false;
      if (sameTargetProviderSwitch) {
        setters.setConnectionState("connected");
        setters.setAssistantProvider(state.connectedProvider);
        setAssistantProvider(state.connectedProvider);
        setters.setNotice(`${providerDisplayName(selectedProvider)} 연결 실패. 기존 ${providerDisplayName(state.connectedProvider)} 연결은 유지됩니다. ${errorMessage(error)}`);
      } else {
        setters.setConnectionState("disconnected");
        setters.setConnectedTarget("");
        if (state.isDaemonClient || state.connectedProvider !== selectedProvider) actions.openConnectionSettings();
        setters.setNotice(errorMessage(error));
      }
      return false;
    }
  };

  const chooseProvider = (next: AssistantProvider, autoConnect = false): void => {
    if (state.busy) return;
    setters.setAssistantProvider(next);
    setAssistantProvider(next);
    if (state.connectionState === "connected") {
      if (next === state.connectedProvider && next === state.assistantProvider) return;
      const requestedTarget = (state.connectedTarget || state.target).trim() || LOCAL_WORKSPACE_TARGET;
      void connect(requestedTarget, next);
      return;
    }
    if (!autoConnect) return;
    const requestedTarget = (state.connectedTarget || state.target).trim() || LOCAL_WORKSPACE_TARGET;
    void connect(requestedTarget, next);
  };

  const refresh = async (): Promise<void> => {
    if (!state.connectedTarget) return;
    try {
      const results = await Promise.all(ASSISTANT_PROVIDERS.map(async ({ id: provider }) => {
        try {
          return {
            provider,
            result: await bridgeRpc.request.connect({ target: state.connectedTarget, provider }),
          };
        } catch {
          return null;
        }
      }));
      const available = results.filter((item): item is NonNullable<typeof item> => item !== null);
      if (!available.length) throw new Error("어떤 프로바이더에서도 세션 목록을 불러오지 못했습니다.");
      for (const item of available) {
        setters.setThreads((current) => replaceProviderThreads(current, item.result.threads, item.provider));
        setters.setProviderCatalogs((current) => ({
          ...current,
          [item.provider]: { models: item.result.models, warning: item.result.modelWarning ?? "", permissionPresets: item.result.permissionPresets ?? [] },
        }));
      }
      const total = available.reduce((count, item) => count + item.result.threads.length, 0);
      setters.setNotice(`전체 프로바이더에서 세션 목록을 새로 고쳤습니다 · ${total}개`);
    } catch (error) {
      setters.setNotice(errorMessage(error));
      if (!state.threads.length) setters.setConnectionState("disconnected");
    }
  };

  const disconnect = async (): Promise<void> => {
    if (state.connectedTarget) {
      try {
        await disconnectProviderSessions(state.connectedTarget);
      } catch (error) {
        setters.setNotice(errorMessage(error));
      }
    }
    actions.clearConnectionState(state.assistantProvider);
    actions.openConnectionSettings();
    setters.setNotice("호스트 연결을 종료했습니다.");
  };

  useEffect(() => {
    if (!state.isDaemonClient) return;
    setters.setTarget(LOCAL_WORKSPACE_TARGET);
    void connect(LOCAL_WORKSPACE_TARGET);
  }, []);

  return { connect, chooseProvider, refresh, disconnect };
}

async function disconnectProviderSessions(target: string): Promise<void> {
  await Promise.allSettled(ASSISTANT_PROVIDERS.map(({ id: provider }) => bridgeRpc.request.disconnect({ target, provider })));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
