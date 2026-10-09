import type { AssistantProvider, HiveBridgeSchema } from "./bridge";
import type { UiBridgeEventListener } from "./bridge-events";
import type { DaemonConnectionsPort } from "./daemon-connections";
import type { PreferencesPort } from "./preferences";

type RequestContracts = HiveBridgeSchema["bun"]["requests"];
type RequestParameters<Request> = Request extends { params: infer Parameters } ? Parameters : never;
type RequestResponse<Request> = Request extends { response: infer Response } ? Response : never;

/** Typed UI-facing bridge contract. The platform implementation is supplied by the desktop composition root. */
export type DesktopBridgeRpcPort = {
  readonly request: {
    [Method in keyof RequestContracts]: (params: RequestParameters<RequestContracts[Method]>) => Promise<RequestResponse<RequestContracts[Method]>>;
  };
};

export type DesktopBridgeRuntimePort = {
  readonly bridgeRpc: DesktopBridgeRpcPort;
  readonly daemonConnections: DaemonConnectionsPort;
  readonly preferences: PreferencesPort;
  readonly isDaemonClient: boolean;
  readonly isMobileApp: boolean;
  readonly isLinuxDesktop: boolean;
  readonly isWindowsDesktop: boolean;
  subscribeWindowFocus(listener: (focused: boolean) => void): () => void;
  addBridgeEventListener(listener: UiBridgeEventListener): void;
  removeBridgeEventListener(listener: UiBridgeEventListener): void;
  connectDaemonBridge(endpoint: string, token: string, fingerprint: string): Promise<void>;
  disconnectDaemonBridge(): void;
  getActiveAssistantProvider(): AssistantProvider;
  setAndroidStatusBarAppearance(light: boolean): void;
  setAssistantProvider(provider: AssistantProvider): void;
  setDesktopDaemonMode(enabled: boolean): void;
};
