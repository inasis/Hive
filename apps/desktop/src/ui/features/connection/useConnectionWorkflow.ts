import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ASSISTANT_PROVIDERS } from "../../../../../../src/domain/provider-catalog.js";
import { LOCAL_WORKSPACE_TARGET, type AssistantProvider, type RemoteThread } from "../../../shared/bridge";
import { replaceProviderThreads } from "../../shared/provider-thread-state";
import { providerDisplayName } from "../../shared/provider-display-name";
import { bridgeRpc, daemonConnections, preferences, setAssistantProvider } from "../../bridgeClient";
import { PREFERENCE_KEYS } from "../../../shared/preferences";
import type { AppPage } from "../../shared/workspace-state";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";

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
  const autoConnecting = useRef(false);
  const activeTarget = useRef(state.connectedTarget);
  activeTarget.current = state.connectedTarget;

  const connect = async (targetOverride?: string, providerOverride?: AssistantProvider): Promise<boolean> => {
    const sequence = ++connectSequence.current;
    const selectedProvider = providerOverride ?? state.assistantProvider;
    const defaultDaemon = daemonConnections.snapshot().find((connection) => connection.state === "connected")?.target;
    const requested = targetOverride ?? (state.isDaemonClient ? state.connectedTarget || defaultDaemon : state.target);
    const requestedTarget = state.isDaemonClient && (!requested || requested === LOCAL_WORKSPACE_TARGET)
      ? defaultDaemon : requested?.trim() || LOCAL_WORKSPACE_TARGET;
    if (!requestedTarget) { setters.setNotice("데몬 관리에서 연결할 컴퓨터를 추가하세요."); actions.openConnectionSettings(); return false; }

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
          if (!state.isDaemonClient) await disconnectProviderSessions(state.connectedTarget);
          if (sequence !== connectSequence.current) return false;
          if (!state.isDaemonClient) { actions.resetWorkspace(selectedProvider); setters.setProviderCatalogs({}); }
        }
      }

      const result = await bridgeRpc.request.connect({ target: requestedTarget, provider: selectedProvider });
      if (sequence !== connectSequence.current) return false;
      if (!state.isDaemonClient && requestedTarget !== LOCAL_WORKSPACE_TARGET) {
        preferences.setItem(PREFERENCE_KEYS.sshTarget, requestedTarget);
      }
      if (state.isDaemonClient && state.connectedTarget !== requestedTarget) { actions.resetProviderThreadView(selectedProvider); setters.setProviderCatalogs({}); }
      setters.setTarget(requestedTarget);
      setters.setConnectedTarget(requestedTarget);
      setters.setConnectedProvider(selectedProvider);

      if (sameTargetProviderSwitch) actions.resetProviderThreadView(selectedProvider);

      setters.setThreads((current) => state.isDaemonClient || requestedTarget === state.connectedTarget
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
      if (!state.isDaemonClient) actions.loadAdditionalProviderThreads(requestedTarget, selectedProvider);
      return true;
    } catch (error) {
      if (sequence !== connectSequence.current) return false;
      if (sameTargetProviderSwitch || (state.isDaemonClient && state.connectedTarget)) {
        setters.setConnectionState(state.connectionState);
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
      const targets = state.isDaemonClient ? daemonConnections.snapshot().filter((connection) => connection.state === "connected").map((connection) => connection.target) : [state.connectedTarget];
      const results = await Promise.all(targets.flatMap((target) => ASSISTANT_PROVIDERS.map(async ({ id: provider }) => {
        try {
          return {
            provider, target,
            result: await bridgeRpc.request.connect({ target, provider }),
          };
        } catch {
          return null;
        }
      })));
      const available = results.filter((item): item is NonNullable<typeof item> => item !== null);
      if (!available.length) throw new Error("어떤 프로바이더에서도 세션 목록을 불러오지 못했습니다.");
      if (state.isDaemonClient && activeTarget.current !== state.connectedTarget) return;
      for (const item of available) {
        if (item.target !== state.connectedTarget) continue;
        setters.setThreads((current) => replaceProviderThreads(current, item.result.threads, item.provider));
        setters.setProviderCatalogs((current) => ({
          ...current,
          [item.provider]: { models: item.result.models, warning: item.result.modelWarning ?? "", permissionPresets: item.result.permissionPresets ?? [] },
        }));
      }
      const total = available.reduce((count, item) => count + item.result.threads.length, 0);
      setters.setNotice(`연결된 호스트의 세션 목록을 새로 고쳤습니다 · ${total}개`);
    } catch (error) {
      setters.setNotice(errorMessage(error));
      if (!state.threads.length) setters.setConnectionState("disconnected");
    }
  };

  const disconnect = async (): Promise<void> => {
    if (state.connectedTarget) {
      try {
        if (state.isDaemonClient) daemonConnections.disconnect(state.connectedTarget.slice(7));
        else await disconnectProviderSessions(state.connectedTarget);
      } catch (error) {
        setters.setNotice(errorMessage(error));
      }
    }
    if (state.isDaemonClient) {
      actions.resetProviderThreadView(state.assistantProvider);
      setters.setConnectionState("disconnected");
    } else actions.clearConnectionState(state.assistantProvider);
    actions.openConnectionSettings();
    setters.setNotice("호스트 연결을 종료했습니다.");
  };

  useEffect(() => {
    if (!state.isDaemonClient || !state.connectedTarget || daemonConnections.snapshot().some((connection) => connection.target === state.connectedTarget)) return;
    actions.resetProviderThreadView(state.assistantProvider);
    setters.setProviderCatalogs({});
    const next = daemonConnections.snapshot().find((connection) => connection.state === "connected");
    if (next) void connect(next.target);
    else { setters.setConnectedTarget(""); setters.setConnectionState("disconnected"); }
  }, [state.connectedTarget, daemonConnections.snapshot()]);

  useEffect(() => {
    if (!state.isDaemonClient) return;
    const selectFirst = () => {
      if (state.connectedTarget || autoConnecting.current) return;
      const first = daemonConnections.snapshot().find((connection) => connection.state === "connected");
      if (first) { autoConnecting.current = true; void connect(first.target).finally(() => { autoConnecting.current = false; }); }
    };
    selectFirst();
    return daemonConnections.subscribe(selectFirst);
  }, [state.connectedTarget]);

  return { connect, chooseProvider, refresh, disconnect };
}

async function disconnectProviderSessions(target: string): Promise<void> {
  await Promise.allSettled(ASSISTANT_PROVIDERS.map(({ id: provider }) => bridgeRpc.request.disconnect({ target, provider })));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
