import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider } from "../../shared/bridge";
import type { BridgeConnectionState, ProviderCatalogs } from "../../shared/provider-ui-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

/** Keep the selected daemon aligned with available connections and select one when they appear. */
export function useDaemonConnectionSelectionLifecycle(dependencies: {
  isDaemonClient: boolean;
  connectedTarget: string;
  assistantProvider: AssistantProvider;
  connect(target: string): Promise<boolean>;
  setters: {
    setConnectedTarget: Dispatch<SetStateAction<string>>;
    setConnectionState: Dispatch<SetStateAction<BridgeConnectionState>>;
    setProviderCatalogs: Dispatch<SetStateAction<ProviderCatalogs>>;
  };
  resetProviderThreadView(provider: AssistantProvider): void;
}): void {
  const { bridge } = useDesktopUiRuntime();
  const { daemonConnections } = bridge;
  const autoConnecting = useRef(false);
  const { isDaemonClient, connectedTarget, assistantProvider, connect, setters, resetProviderThreadView } = dependencies;

  useEffect(() => {
    if (!isDaemonClient || !connectedTarget || daemonConnections.snapshot().some((connection) => connection.target === connectedTarget)) return;
    resetProviderThreadView(assistantProvider);
    setters.setProviderCatalogs({});
    const next = daemonConnections.snapshot().find((connection) => connection.state === "connected");
    if (next) void connect(next.target);
    else { setters.setConnectedTarget(""); setters.setConnectionState("disconnected"); }
  }, [bridge, connectedTarget, daemonConnections.snapshot()]);

  useEffect(() => {
    if (!isDaemonClient) return;
    const selectFirst = () => {
      if (connectedTarget || autoConnecting.current) return;
      const first = daemonConnections.snapshot().find((connection) => connection.state === "connected");
      if (first) { autoConnecting.current = true; void connect(first.target).finally(() => { autoConnecting.current = false; }); }
    };
    selectFirst();
    return daemonConnections.subscribe(selectFirst);
  }, [bridge, connectedTarget]);
}
