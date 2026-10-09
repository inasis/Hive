import { useCallback, useEffect, useRef, useSyncExternalStore, useState, type Dispatch, type SetStateAction } from "react";
import { ASSISTANT_PROVIDERS, DEFAULT_ASSISTANT_PROVIDER } from "../../../domain/provider-catalog.js";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { listAssistantProviderInfoDtos } from "../../../application/mappers/assistant-catalog-mapper.js";
import type { AssistantProvider, AssistantProviderInfo, RemoteThread } from "../../shared/bridge";
import { PREFERENCE_KEYS, type PreferencesPort } from "../../shared/preferences";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

type StateSetter<T> = Dispatch<SetStateAction<T>>;
const BUILT_IN_PROVIDER_DTOS = listAssistantProviderInfoDtos();

export type ConnectionUiState = {
  assistantProvider: AssistantProvider;
  availableProviders: AssistantProviderInfo[];
  target: string;
  connectedTarget: string;
  connectedProvider: AssistantProvider;
  connectionState: BridgeConnectionState;
  threads: RemoteThread[];
  providerCatalogs: ProviderCatalogs;
};

export type ConnectionUiSetters = {
  setAssistantProvider: StateSetter<AssistantProvider>;
  setAvailableProviders: StateSetter<AssistantProviderInfo[]>;
  setTarget: StateSetter<string>;
  setConnectedTarget: StateSetter<string>;
  setConnectedProvider: StateSetter<AssistantProvider>;
  setConnectionState: StateSetter<BridgeConnectionState>;
  setThreads: StateSetter<RemoteThread[]>;
  setProviderCatalogs: StateSetter<ProviderCatalogs>;
};

export function useConnectionState({ daemonClient }: {
  daemonClient: boolean;
}): { state: ConnectionUiState; setters: ConnectionUiSetters } {
  const { bridge } = useDesktopUiRuntime();
  const [assistantProvider, setAssistantProvider] = useState(() => readStoredAssistantProvider(bridge.preferences));
  const [availableProviders, setAvailableProviders] = useState<AssistantProviderInfo[]>(() => [...BUILT_IN_PROVIDER_DTOS]);
  const [target, setTarget] = useState(() => daemonClient ? LOCAL_WORKSPACE_TARGET : bridge.preferences.getItem(PREFERENCE_KEYS.sshTarget) ?? "");
  const [connectedTarget, setConnectedTargetState] = useState("");
  const targetRef = useRef("");
  const connections = useSyncExternalStore(bridge.daemonConnections.subscribe, bridge.daemonConnections.snapshot);
  const setConnectedTarget = useCallback<StateSetter<string>>((value) => {
    const next = typeof value === "function" ? value(targetRef.current) : value;
    targetRef.current = next;
    setConnectedTargetState(next);
  }, []);
  const [connectedProvider, setConnectedProvider] = useState<AssistantProvider>(assistantProvider);
  const [connectionState, setConnectionState] = useState<BridgeConnectionState>("disconnected");
  const [localThreads, setLocalThreads] = useState<RemoteThread[]>([]);
  const threads = daemonClient ? connections.find((connection) => connection.target === connectedTarget)?.threads ?? [] : localThreads;
  const setThreads = useCallback<StateSetter<RemoteThread[]>>((value) => {
    if (!daemonClient) { setLocalThreads(value); return; }
    const target = targetRef.current;
    const current = bridge.daemonConnections.snapshot().find((connection) => connection.target === target)?.threads ?? [];
    bridge.daemonConnections.updateThreads(target, typeof value === "function" ? value(current) : value);
  }, [bridge, daemonClient]);
  const [providerCatalogs, setProviderCatalogs] = useState<ProviderCatalogs>({});

  useEffect(() => {
    bridge.setAssistantProvider(assistantProvider);
  }, [bridge, assistantProvider]);

  useEffect(() => {
    let disposed = false;
    void bridge.bridgeRpc.request.listProviders({}).then((result) => {
      if (disposed) return;
      const providersById = new Map<AssistantProvider, AssistantProviderInfo>(
        BUILT_IN_PROVIDER_DTOS.map((provider) => [provider.id, provider]),
      );
      for (const provider of result.providers) providersById.set(provider.id, provider);
      setAvailableProviders([...providersById.values()]);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [bridge]);

  return {
    state: {
      assistantProvider,
      availableProviders,
      target,
      connectedTarget,
      connectedProvider,
      connectionState,
      threads,
      providerCatalogs,
    },
    setters: {
      setAssistantProvider,
      setAvailableProviders,
      setTarget,
      setConnectedTarget,
      setConnectedProvider,
      setConnectionState,
      setThreads,
      setProviderCatalogs,
    },
  };
}

export function readStoredAssistantProvider(preferences: PreferencesPort): AssistantProvider {
  const storedProvider = preferences.getItem(PREFERENCE_KEYS.assistantProvider);
  return ASSISTANT_PROVIDERS.find((provider) => provider.id === storedProvider)?.id ?? DEFAULT_ASSISTANT_PROVIDER;
}
