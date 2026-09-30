import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { LOCAL_WORKSPACE_TARGET, type AssistantProvider, type RemoteThread } from "../../../shared/bridge";
import {
  addUiBridgeEventListener,
  bridgeRpc,
  isDaemonClient,
  isMobileApp,
  markDaemonProviderRestoreFailed,
  markDaemonProviderRestored,
  removeUiBridgeEventListener,
} from "../../bridgeClient";
import { providerDisplayName } from "../../shared/provider-display-name";
import type { UiBridgeEvent } from "../../shared/bridge-event-adapter";
import { replaceProviderThreads } from "../../shared/provider-thread-state";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";

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
    setActivePage: Dispatch<SetStateAction<"sessions" | "settings">>;
    setConnectedProvider: Dispatch<SetStateAction<AssistantProvider>>;
  };
  loadAdditionalProviderThreads(target: string, provider: AssistantProvider): void;
  restoreThread(thread: RemoteThread, sideChatId: string): Promise<void>;
}) {
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
      if (event.type === "transportDisconnected") {
        if (isDaemonClient) {
          setters.setConnectionState("connecting");
          setters.setNotice("데몬 연결이 끊어졌습니다. 자동으로 다시 연결하고 있습니다…");
        }
        return;
      }
      if (event.type === "transportFailed") {
        if (isDaemonClient) {
          setters.setConnectionState("disconnected");
          setters.setNotice(event.message ?? "데몬 연결을 복구하지 못했습니다. 연결 설정을 확인하세요.");
        }
        return;
      }
      if (event.type === "transportKeepAliveFailed") {
        if (isMobileApp) setters.setNotice(`백그라운드 연결 유지 서비스를 시작하지 못했습니다: ${event.message ?? "Android 서비스 오류"}`);
        return;
      }
      if (event.type !== "transportReconnected" || !isDaemonClient) return;

      setters.setConnectionState("connecting");
      setters.setNotice("데몬 연결이 복구되었습니다. 세션 목록을 불러오는 중…");
      void bridgeRpc.request.connect({ target: LOCAL_WORKSPACE_TARGET, provider })
        .then(async (result) => {
          setters.setTarget(LOCAL_WORKSPACE_TARGET);
          setters.setConnectedTarget(LOCAL_WORKSPACE_TARGET);
          setters.setThreads((current) => replaceProviderThreads(current, result.threads, provider));
          setters.setProviderCatalogs((current) => ({ ...current, [provider]: { models: result.models, warning: result.modelWarning ?? "", permissionPresets: result.permissionPresets ?? [] } }));
          setters.setConnectionState("connected");
          setters.setActivePage("sessions");
          setters.setConnectedProvider(provider);
          loadAdditionalProviderThreads.current(LOCAL_WORKSPACE_TARGET, provider);
          const selected = activeThread.current;
          const selectedThread = selected.thread;
          if (selectedThread && selected.target === LOCAL_WORKSPACE_TARGET && selectedThread.provider === provider) {
            const thread = result.threads.find((candidate) => candidate.id === selectedThread.id && candidate.provider === provider) ?? selectedThread;
            await restoreThread.current(thread, selected.sideChatId);
          } else {
            setters.setNotice(`데몬 연결이 복구되었습니다 · ${providerDisplayName(provider)} 세션 ${result.threads.length}개`);
          }
          markDaemonProviderRestored(LOCAL_WORKSPACE_TARGET, provider);
        })
        .catch((error: unknown) => {
          markDaemonProviderRestoreFailed(LOCAL_WORKSPACE_TARGET, provider, errorMessage(error));
          setters.setConnectionState("disconnected");
          setters.setNotice(`데몬에는 다시 연결했지만 ${providerDisplayName(provider)} 세션을 불러오지 못했습니다: ${errorMessage(error)}`);
        });
    };

    addUiBridgeEventListener(onEvent);
    return () => removeUiBridgeEventListener(onEvent);
  }, [provider, setters]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
