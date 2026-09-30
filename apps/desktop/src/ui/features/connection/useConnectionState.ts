import { useCallback, useEffect, useRef, useSyncExternalStore, useState, type Dispatch, type SetStateAction } from "react";
import { ASSISTANT_PROVIDERS, DEFAULT_ASSISTANT_PROVIDER } from "../../../../../../src/domain/provider-catalog.js";
import { LOCAL_WORKSPACE_TARGET, type AssistantProvider, type AssistantProviderInfo, type RemoteThread } from "../../../shared/bridge";
import { bridgeRpc, daemonConnections, preferences, setAssistantProvider as setBridgeAssistantProvider } from "../../bridgeClient";
import { PREFERENCE_KEYS } from "../../../shared/preferences";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

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
  const [assistantProvider, setAssistantProvider] = useState(readStoredAssistantProvider);
  const [availableProviders, setAvailableProviders] = useState<AssistantProviderInfo[]>(() => [...ASSISTANT_PROVIDERS]);
  const [target, setTarget] = useState(() => daemonClient ? LOCAL_WORKSPACE_TARGET : preferences.getItem(PREFERENCE_KEYS.sshTarget) ?? "");
  const [connectedTarget, setConnectedTargetState] = useState("");
  const targetRef = useRef("");
  const connections = useSyncExternalStore(daemonConnections.subscribe, daemonConnections.snapshot);
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
    const current = daemonConnections.snapshot().find((connection) => connection.target === target)?.threads ?? [];
    daemonConnections.updateThreads(target, typeof value === "function" ? value(current) : value);
  }, [daemonClient]);
  const [providerCatalogs, setProviderCatalogs] = useState<ProviderCatalogs>({});

  useEffect(() => {
    setBridgeAssistantProvider(assistantProvider);
  }, [assistantProvider]);

  useEffect(() => {
    let disposed = false;
    void bridgeRpc.request.listProviders({}).then((result) => {
      if (disposed) return;
      const providersById = new Map(ASSISTANT_PROVIDERS.map((provider) => [provider.id, provider]));
      for (const provider of result.providers) providersById.set(provider.id, provider);
      setAvailableProviders([...providersById.values()]);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

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

export function readStoredAssistantProvider(): AssistantProvider {
  const storedProvider = preferences.getItem(PREFERENCE_KEYS.assistantProvider);
  return ASSISTANT_PROVIDERS.find((provider) => provider.id === storedProvider)?.id ?? DEFAULT_ASSISTANT_PROVIDER;
}
