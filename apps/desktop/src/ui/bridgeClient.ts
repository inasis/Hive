import { Electroview } from "electrobun/view";
import { DEFAULT_ASSISTANT_PROVIDER, isAssistantProvider } from "../../../../src/domain/provider-catalog.js";
import { parseBridgeEvent } from "../../../../src/interfaces/contracts/daemon-events.js";
import { isProviderDaemonApiMethod } from "../../../../src/interfaces/contracts/daemon-api.js";
import { LOCAL_WORKSPACE_TARGET, type AssistantProvider, type BridgeEvent, type HiveBridgeSchema } from "../shared/bridge";
import { MobileDaemonTransport } from "../platform/mobile-daemon-transport";
import { browserPreferences } from "../platform/browser-preferences";
import { PREFERENCE_KEYS, type PreferencesPort } from "../shared/preferences";
import { normalizeBridgeEvent, type UiBridgeEventListener } from "./shared/bridge-event-adapter";

const nativeRpc = Electroview.defineRPC<HiveBridgeSchema>({
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
export const isLinuxDesktop = typeof navigator !== "undefined" && !isMobileApp && /linux/i.test(navigator.platform);
export const preferences: PreferencesPort = browserPreferences;
let activeAssistantProvider: AssistantProvider = readAssistantProvider();
export let isDaemonClient = isMobileApp || (isLinuxDesktop && readDesktopDaemonMode());
const isAndroidApp = isMobileApp && window.Capacitor?.getPlatform?.() === "android";

const mobileTransport = new MobileDaemonTransport(isAndroidApp, () => isLinuxDesktop && isDaemonClient, {
  connect: async (credentials) => { await nativeRpc.request.daemonConnect(credentials); },
  request: (request) => nativeRpc.request.daemonRequest(request),
  disconnect: async () => { await nativeRpc.request.daemonDisconnect({}); },
});
const uiEventListeners = new Map<UiBridgeEventListener, (event: BridgeEvent) => void>();

export function setAndroidStatusBarAppearance(light: boolean): void {
  mobileTransport.setStatusBarAppearance(light);
}

export function setLinuxDaemonMode(enabled: boolean): void {
  if (!isLinuxDesktop) return;
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

if (!isMobileApp) new Electroview({ rpc: nativeRpc });

export function connectMobileBridge(endpoint: string, token: string, fingerprint: string): Promise<void> {
  return mobileTransport.connect(endpoint, token, fingerprint);
}

export function disconnectMobileBridge(): void {
  mobileTransport.disconnect();
}

export function addUiBridgeEventListener(listener: UiBridgeEventListener): void {
  removeUiBridgeEventListener(listener);
  const onWireEvent = (wireEvent: BridgeEvent) => {
    const event = parseBridgeEvent(wireEvent);
    if (!event) return;
    for (const uiEvent of normalizeBridgeEvent(event)) listener(uiEvent);
  };
  uiEventListeners.set(listener, onWireEvent);
  if (isMobileApp) mobileTransport.addEventListener(onWireEvent);
  else nativeRpc.addMessageListener("event", onWireEvent);
}

export function removeUiBridgeEventListener(listener: UiBridgeEventListener): void {
  const onWireEvent = uiEventListeners.get(listener);
  if (!onWireEvent) return;
  uiEventListeners.delete(listener);
  if (isMobileApp) mobileTransport.removeEventListener(onWireEvent);
  else nativeRpc.removeMessageListener("event", onWireEvent);
}

export const bridgeRpc = new Proxy(nativeRpc, {
  get(target, property, receiver) {
    if (property === "request") {
      return new Proxy(target.request, {
        get(requests, method) {
          if (typeof method !== "string") return Reflect.get(requests, method);
          const request = Reflect.get(requests, method) as ((params: unknown) => unknown) | undefined;
          const includeProvider = isProviderDaemonApiMethod(method);
          const injectProvider = (params: unknown) => {
            if (!includeProvider || typeof params !== "object" || params === null || Array.isArray(params)) return params;
            const object = params as Record<string, unknown>;
            return { ...object, provider: object.provider ?? activeAssistantProvider };
          };
          if (isLinuxDesktop && isDaemonClient && ["windowAction", "getGtkSettings", "getWindowFrame", "setWindowFrame", "daemonConnect", "daemonRequest", "daemonDisconnect"].includes(method)) {
            return Reflect.get(requests, method);
          }
          if (!isMobileApp && !(isLinuxDesktop && isDaemonClient)) {
            return includeProvider && request ? (params: unknown) => request(injectProvider(params)) : request;
          }
          return (params: unknown) => mobileTransport.request(method, injectProvider(params));
        },
      });
    }
    if (property === "addMessageListener") {
      if (!isMobileApp) return Reflect.get(target, property, receiver);
      return (_name: string, listener: (event: BridgeEvent) => void) => mobileTransport.addEventListener(listener);
    }
    if (property === "removeMessageListener") {
      if (!isMobileApp) return Reflect.get(target, property, receiver);
      return (_name: string, listener: (event: BridgeEvent) => void) => mobileTransport.removeEventListener(listener);
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
    return preferences.getItem(PREFERENCE_KEYS.desktopConnectionMode) !== "direct";
  } catch {
    return true;
  }
}
