import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import type { AssistantProvider, RemoteThread } from "../../shared/bridge";
import { providerDisplayName } from "../../shared/provider-display-name";
import type { UiBridgeEvent } from "../../shared/bridge-events";
import { replaceProviderThreads } from "../../shared/provider-thread-state";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import type { AppPage } from "../../shared/workspace-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

export function useTransportLifecycleEvents(dependencies: {
  provider: AssistantProvider;
  activeThread: {
    target: string;
    thread: RemoteThread | null;
    sideChatId: string;
  };
  setters: {
    setConnectionState: Dispatch<SetStateAction<BridgeConnectionState>>;
    setNotice: Dispatch<SetStateAction<string>>;
    setTarget: Dispatch<SetStateAction<string>>;
    setConnectedTarget: Dispatch<SetStateAction<string>>;
    setThreads: Dispatch<SetStateAction<RemoteThread[]>>;
    setProviderCatalogs: Dispatch<SetStateAction<ProviderCatalogs>>;
    setActivePage: Dispatch<SetStateAction<AppPage>>;
    setConnectedProvider: Dispatch<SetStateAction<AssistantProvider>>;
  };
  loadAdditionalProviderThreads(target: string, provider: AssistantProvider): void;
  restoreThread(thread: RemoteThread, sideChatId: string): Promise<void>;
}) {
  const { bridge, promptRecovery, providerConnectionRecovery } = useDesktopUiRuntime();
  const { provider, setters } = dependencies;
  const loadAdditionalProviderThreads = useRef(dependencies.loadAdditionalProviderThreads);
  const activeThread = useRef(dependencies.activeThread);
  const restoreThread = useRef(dependencies.restoreThread);

  useEffect(() => {
    loadAdditionalProviderThreads.current = dependencies.loadAdditionalProviderThreads;
  }, [dependencies.loadAdditionalProviderThreads]);

  useEffect(() => {
    activeThread.current = dependencies.activeThread;
    restoreThread.current = dependencies.restoreThread;
  }, [dependencies.activeThread, dependencies.restoreThread]);

  useEffect(() => {
    const onEvent = (event: UiBridgeEvent) => {
      if (event.target && event.target !== activeThread.current.target) return;
      if (event.type === "transportDisconnected") {
        if (bridge.isDaemonClient) {
          setters.setConnectionState("connecting");
          setters.setNotice("서버 연결이 끊어졌습니다. 자동으로 다시 연결하고 있습니다…");
        }
        return;
      }
      if (event.type === "transportFailed") {
        if (bridge.isDaemonClient) {
          setters.setConnectionState("disconnected");
          setters.setNotice(event.message ?? "서버 연결을 복구하지 못했습니다. 연결 설정을 확인하세요.");
        }
        return;
      }
      if (event.type === "transportKeepAliveFailed") {
        if (bridge.isMobileApp) setters.setNotice(`백그라운드 연결 유지 서비스를 시작하지 못했습니다: ${event.message ?? "Android 서비스 오류"}`);
        return;
      }
      if (event.type !== "transportReconnected" || !bridge.isDaemonClient) return;

      setters.setConnectionState("connecting");
      setters.setNotice("서버 연결이 복구되었습니다. 세션 목록을 불러오는 중…");
      const target = activeThread.current.target || LOCAL_WORKSPACE_TARGET;
      void providerConnectionRecovery.restore({
        target,
        provider,
        activeThread: activeThread.current.thread
          ? {
              target: activeThread.current.target,
              thread: activeThread.current.thread,
              sideChatId: activeThread.current.sideChatId,
            }
          : null,
      })
        .then(async ({ catalog, selection }) => {
          setters.setTarget(target);
          setters.setConnectedTarget(target);
          setters.setThreads((current) => replaceProviderThreads(current, catalog.threads, provider));
          setters.setProviderCatalogs((current) => ({ ...current, [provider]: { models: catalog.models, warning: catalog.modelWarning ?? "", permissionPresets: catalog.permissionPresets ?? [] } }));
          setters.setConnectionState("connected");
          setters.setActivePage("sessions");
          setters.setConnectedProvider(provider);
          loadAdditionalProviderThreads.current(target, provider);
          if (selection) {
            await restoreThread.current(selection.thread, selection.sideChatId);
          } else {
            setters.setNotice(`서버 연결이 복구되었습니다 · ${providerDisplayName(provider)} 세션 ${catalog.threads.length}개`);
          }
          promptRecovery.markProviderRestored(target, provider);
        })
        .catch((error: unknown) => {
          promptRecovery.markProviderRestoreFailed(target, provider, errorMessage(error));
          setters.setConnectionState("disconnected");
          setters.setNotice(`서버에는 다시 연결했지만 ${providerDisplayName(provider)} 세션을 불러오지 못했습니다: ${errorMessage(error)}`);
        });
    };

    bridge.addBridgeEventListener(onEvent);
    return () => bridge.removeBridgeEventListener(onEvent);
  }, [bridge, promptRecovery, provider, setters]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
