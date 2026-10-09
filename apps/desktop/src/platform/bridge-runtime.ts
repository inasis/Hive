import { Electroview } from "electrobun/view";
import { DEFAULT_ASSISTANT_PROVIDER, isAssistantProvider } from "../../../../src/domain/provider-catalog.js";
import { LOCAL_WORKSPACE_TARGET } from "../../../../src/domain/workspace.js";
import { parseBridgeEvent } from "../../../../src/application/dto/daemon/daemon-events.js";
import type { AssistantProvider, BridgeEvent, HiveBridgeSchema } from "../../../../src/presentation/shared/bridge";
import type { UiBridgeEventListener } from "../../../../src/presentation/shared/bridge-events";
import { normalizeBridgeEvent } from "./bridge-event-adapter";
import { DaemonConnections } from "./daemon-connections";
import { DaemonClientTransport } from "./daemon-client-transport";
import { MobileDeviceAdapter } from "./mobile-device";
import { browserPreferences } from "./browser-preferences";
import type { DaemonConnectionsPort } from "../../../../src/presentation/shared/daemon-connections";
import { PREFERENCE_KEYS, type PreferencesPort } from "../../../../src/presentation/shared/preferences";
import type { DesktopBridgeRuntimePort } from "../../../../src/presentation/shared/bridge-runtime";
import { createBridgeRpcRequestRouter } from "./bridge-rpc-request-router";

const nativeRpc = Electroview.defineRPC<HiveBridgeSchema>({
  maxRequestTime: 120_000,
  handlers: { requests: {}, messages: {} },
});

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }
}

export const isMobileApp = typeof window !== "undefined" && (
  window.Capacitor?.isNativePlatform?.() === true ||
  window.location.protocol === "capacitor:"
);
const desktopPlatform = typeof navigator === "undefined"
  ? ""
  : `${navigator.platform} ${navigator.userAgent}`;
export const isLinuxDesktop = typeof navigator !== "undefined" && !isMobileApp && /linux/i.test(desktopPlatform);
export const isWindowsDesktop = typeof navigator !== "undefined" && !isMobileApp && /windows|win32|win64/i.test(desktopPlatform);
export const preferences: PreferencesPort = browserPreferences;
let activeAssistantProvider: AssistantProvider = readAssistantProvider();
export let isDaemonClient = isMobileApp || readDesktopDaemonMode();
const isAndroidApp = isMobileApp && window.Capacitor?.getPlatform?.() === "android";
const mobileDeviceAdapter = new MobileDeviceAdapter(isAndroidApp);

const daemonConnectionsAdapter = new DaemonConnections(preferences, (connectionId) => new DaemonClientTransport(
  isAndroidApp, () => !isMobileApp && isDaemonClient, {
    connect: async (credentials) => { await nativeRpc.request.daemonConnect({ ...credentials, connectionId }); },
    request: (request) => nativeRpc.request.daemonRequest({ ...request, connectionId }),
    disconnect: async () => { await nativeRpc.request.daemonDisconnect({ connectionId }); },
  },
  mobileDeviceAdapter,
));
export const daemonConnections: DaemonConnectionsPort = daemonConnectionsAdapter;
if (!isMobileApp) nativeRpc.addMessageListener("event", (event) => {
  const parsed = parseBridgeEvent(event);
  if (parsed) daemonConnectionsAdapter.receive(parsed);
});

const bridgeEventListeners = new Map<UiBridgeEventListener, (event: BridgeEvent) => void>();

export function setAndroidStatusBarAppearance(light: boolean): void {
  mobileDeviceAdapter.setStatusBarAppearance(light);
}

export function setDesktopDaemonMode(enabled: boolean): void {
  isDaemonClient = enabled;
  try {
    preferences.setItem(PREFERENCE_KEYS.desktopConnectionMode, enabled ? "daemon" : "direct");
    if (!enabled && preferences.getItem(PREFERENCE_KEYS.sshTarget) === LOCAL_WORKSPACE_TARGET) {
      preferences.removeItem(PREFERENCE_KEYS.sshTarget);
    }
  } catch {}
}

export function setAssistantProvider(provider: AssistantProvider): void {
  activeAssistantProvider = provider;
  try { preferences.setItem(PREFERENCE_KEYS.assistantProvider, provider); } catch {}
}

export function getActiveAssistantProvider(): AssistantProvider {
  return activeAssistantProvider;
}

if (!isMobileApp) new Electroview({ rpc: nativeRpc });

export function connectDaemonBridge(endpoint: string, token: string, fingerprint: string): Promise<void> {
  return daemonConnections.add({ endpoint, token, fingerprint });
}

export function disconnectDaemonBridge(): void {
  for (const connection of daemonConnections.snapshot()) daemonConnections.disconnect(connection.id);
}

export function addBridgeEventListener(listener: UiBridgeEventListener): void {
  removeBridgeEventListener(listener);
  const onWireEvent = (wireEvent: BridgeEvent) => {
    const event = parseBridgeEvent(wireEvent);
    if (!event) return;
    for (const normalized of normalizeBridgeEvent(event)) listener(normalized);
  };
  bridgeEventListeners.set(listener, onWireEvent);
  if (isDaemonClient) daemonConnectionsAdapter.addEventListener(onWireEvent);
  else nativeRpc.addMessageListener("event", onWireEvent);
}

export function removeBridgeEventListener(listener: UiBridgeEventListener): void {
  const onWireEvent = bridgeEventListeners.get(listener);
  if (!onWireEvent) return;
  bridgeEventListeners.delete(listener);
  daemonConnectionsAdapter.removeEventListener(onWireEvent);
  if (!isMobileApp) nativeRpc.removeMessageListener("event", onWireEvent);
}

export function subscribeWindowFocus(listener: (focused: boolean) => void): () => void {
  const onWindowFocus = ({ focused }: { focused: boolean }) => listener(focused);
  nativeRpc.addMessageListener("windowFocus", onWindowFocus);
  return () => nativeRpc.removeMessageListener("windowFocus", onWindowFocus);
}

export const bridgeRpc = new Proxy(nativeRpc, {
  get(target, property, receiver) {
    if (property === "request") {
      return createBridgeRpcRequestRouter(target.request, {
        isMobileApp,
        isDaemonClient: () => isDaemonClient,
        getActiveAssistantProvider: () => activeAssistantProvider,
        requestDaemon: (method, params) => daemonConnectionsAdapter.request(method, params),
      });
    }
    if (property === "addMessageListener") {
      if (!isDaemonClient) return Reflect.get(target, property, receiver);
      return (_name: string, listener: (event: BridgeEvent) => void) => daemonConnectionsAdapter.addEventListener(listener);
    }
    if (property === "removeMessageListener") {
      if (!isDaemonClient) return Reflect.get(target, property, receiver);
      return (_name: string, listener: (event: BridgeEvent) => void) => daemonConnectionsAdapter.removeEventListener(listener);
    }
    return Reflect.get(target, property, receiver);
  },
}) as typeof nativeRpc;

function readAssistantProvider(): AssistantProvider {
  try {
    const value = preferences.getItem(PREFERENCE_KEYS.assistantProvider);
    return isAssistantProvider(value) ? value : DEFAULT_ASSISTANT_PROVIDER;
  }
  catch { return DEFAULT_ASSISTANT_PROVIDER; }
}

function readDesktopDaemonMode(): boolean {
  try {
    const mode = preferences.getItem(PREFERENCE_KEYS.desktopConnectionMode);
    const savedTarget = preferences.getItem(PREFERENCE_KEYS.sshTarget) ?? "";
    if (savedTarget.startsWith("hive+tcp://") || savedTarget.startsWith("hive+tls://")) {
      preferences.setItem(PREFERENCE_KEYS.desktopConnectionMode, "daemon");
      preferences.removeItem(PREFERENCE_KEYS.sshTarget);
      return true;
    }
    return mode === null ? true : mode !== "direct";
  } catch {
    return true;
  }
}

export const bridgeRuntime: DesktopBridgeRuntimePort = {
  get bridgeRpc() { return bridgeRpc; },
  daemonConnections,
  preferences,
  get isDaemonClient() { return isDaemonClient; },
  isMobileApp,
  isLinuxDesktop,
  isWindowsDesktop,
  subscribeWindowFocus,
  addBridgeEventListener,
  removeBridgeEventListener,
  connectDaemonBridge,
  disconnectDaemonBridge,
  getActiveAssistantProvider,
  setAndroidStatusBarAppearance,
  setAssistantProvider,
  setDesktopDaemonMode,
};
