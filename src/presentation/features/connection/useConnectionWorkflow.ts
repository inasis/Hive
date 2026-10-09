import { useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import type { AssistantProvider, RemoteThread } from "../../shared/bridge";
import { replaceProviderThreads } from "../../shared/provider-thread-state";
import { providerDisplayName } from "../../shared/provider-display-name";
import { PREFERENCE_KEYS } from "../../shared/preferences";
import type { AppPage } from "../../shared/workspace-state";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";
import { refreshConnectedProviderCatalogs } from "./refresh-connected-provider-catalogs";

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

/** Own provider connection, switch, and catalog refresh workflows for the desktop and mobile UI. */
export function useConnectionWorkflow({ state, setters, actions }: ConnectionWorkflowOptions) {
  const { bridge, providerCatalogRefresh, providerSessionsDisconnect } = useDesktopUiRuntime();
  const { daemonConnections } = bridge;
  const connectSequence = useRef(0);
  const activeTarget = useRef(state.connectedTarget);
  activeTarget.current = state.connectedTarget;

  const connect = async (targetOverride?: string, providerOverride?: AssistantProvider): Promise<boolean> => {
    const sequence = ++connectSequence.current;
    const selectedProvider = providerOverride ?? state.assistantProvider;
    const defaultDaemon = daemonConnections.snapshot().find((connection) => connection.state === "connected")?.target;
    const requested = targetOverride ?? (state.isDaemonClient ? state.connectedTarget || defaultDaemon : state.target);
    const requestedTarget = state.isDaemonClient && (!requested || requested === LOCAL_WORKSPACE_TARGET)
      ? defaultDaemon : requested?.trim() || LOCAL_WORKSPACE_TARGET;
    if (!requestedTarget) { setters.setNotice("서버 관리에서 연결할 컴퓨터를 추가하세요."); actions.openConnectionSettings(); return false; }

    const sameTargetProviderSwitch = state.connectedTarget === requestedTarget && state.connectedProvider !== selectedProvider;
    if (state.activeThreadId && state.connectedTarget) {
      actions.cacheActiveThreadView(true, state.activeThreadProvider ?? state.connectedProvider);
    }
    setters.setAssistantProvider(selectedProvider);
    bridge.setAssistantProvider(selectedProvider);
    setters.setConnectionState("connecting");
    setters.setNotice(`${providerDisplayName(selectedProvider)}로 연결하는 중…`);

    try {
      if (state.connectedTarget && (state.connectedTarget !== requestedTarget || state.connectedProvider !== selectedProvider)) {
        if (!sameTargetProviderSwitch) {
          if (!state.isDaemonClient) await providerSessionsDisconnect.disconnectAll(state.connectedTarget);
          if (sequence !== connectSequence.current) return false;
          if (!state.isDaemonClient) { actions.resetWorkspace(selectedProvider); setters.setProviderCatalogs({}); }
        }
      }

      const result = await bridge.bridgeRpc.request.connect({ target: requestedTarget, provider: selectedProvider });
      if (sequence !== connectSequence.current) return false;
      if (!state.isDaemonClient && requestedTarget !== LOCAL_WORKSPACE_TARGET) {
        bridge.preferences.setItem(PREFERENCE_KEYS.sshTarget, requestedTarget);
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
        bridge.setAssistantProvider(state.connectedProvider);
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
    bridge.setAssistantProvider(next);
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

  const refresh = (): Promise<void> => refreshConnectedProviderCatalogs({
    state: {
      connectedTarget: state.connectedTarget,
      isDaemonClient: state.isDaemonClient,
      threads: state.threads,
    },
    getActiveTarget: () => activeTarget.current,
    daemonConnections,
    providerCatalogRefresh,
    setters: {
      setConnectionState: setters.setConnectionState,
      setNotice: setters.setNotice,
      setThreads: setters.setThreads,
      setProviderCatalogs: setters.setProviderCatalogs,
    },
  });

  const disconnect = async (): Promise<void> => {
    if (state.connectedTarget) {
      try {
        if (state.isDaemonClient) daemonConnections.disconnect(state.connectedTarget.slice(7));
        else await providerSessionsDisconnect.disconnectAll(state.connectedTarget);
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

  return { connect, chooseProvider, refresh, disconnect };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
