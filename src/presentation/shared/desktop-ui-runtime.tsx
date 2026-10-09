import { createContext, useContext, type ReactNode } from "react";
import type { PromptRecoveryControllerPort } from "../../application/ports/prompt-recovery.js";
import type { ProviderConnectionRecoveryPort } from "../../application/ports/provider-connection-recovery.js";
import type { ProviderCatalogRefreshPort } from "../../application/ports/provider-catalog.js";
import type { ProviderSessionsDisconnectPort } from "../../application/ports/provider-disconnect.js";
import type { DaemonApiRequestMap } from "../../application/dto/daemon/daemon-api.js";
import type { DesktopBridgeRuntimePort } from "./bridge-runtime";

export type DesktopUiRuntime = {
  bridge: DesktopBridgeRuntimePort;
  renderDesktopWindowControls?(onError?: (message: string) => void): ReactNode;
  promptRecovery: PromptRecoveryControllerPort<DaemonApiRequestMap["sendPrompt"]>;
  providerConnectionRecovery: ProviderConnectionRecoveryPort;
  providerCatalogRefresh: ProviderCatalogRefreshPort;
  providerSessionsDisconnect: ProviderSessionsDisconnectPort;
};

const DesktopUiRuntimeContext = createContext<DesktopUiRuntime | null>(null);

export function DesktopUiRuntimeProvider({ runtime, children }: { runtime: DesktopUiRuntime; children: ReactNode }) {
  return <DesktopUiRuntimeContext.Provider value={runtime}>{children}</DesktopUiRuntimeContext.Provider>;
}

export function useDesktopUiRuntime(): DesktopUiRuntime {
  const runtime = useContext(DesktopUiRuntimeContext);
  if (!runtime) throw new Error("Desktop UI runtime provider is missing");
  return runtime;
}
