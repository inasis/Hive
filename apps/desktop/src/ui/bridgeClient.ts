import { Electroview } from "electrobun/view";
import { DEFAULT_ASSISTANT_PROVIDER, isAssistantProvider } from "../../../../src/domain/provider-catalog.js";
import { parseBridgeEvent } from "../../../../src/interfaces/contracts/daemon-events.js";
import { isProviderDaemonApiMethod, type DaemonApiRequestMap, type DaemonApiResponseMap } from "../../../../src/interfaces/contracts/daemon-api.js";
import { LOCAL_WORKSPACE_TARGET, type AssistantProvider, type BridgeEvent, type HiveBridgeSchema } from "../shared/bridge";
import { DaemonConnections } from "../platform/daemon-connections";
import { DaemonClientTransport } from "../platform/daemon-client-transport";
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
const desktopPlatform = typeof navigator === "undefined"
  ? ""
  : `${navigator.platform} ${navigator.userAgent}`;
export const isLinuxDesktop = typeof navigator !== "undefined" && !isMobileApp && /linux/i.test(desktopPlatform);
export const isWindowsDesktop = typeof navigator !== "undefined" && !isMobileApp && /windows|win32|win64/i.test(desktopPlatform);
export const preferences: PreferencesPort = browserPreferences;
let activeAssistantProvider: AssistantProvider = readAssistantProvider();
export let isDaemonClient = isMobileApp || readDesktopDaemonMode();
const isAndroidApp = isMobileApp && window.Capacitor?.getPlatform?.() === "android";

const daemonClientTransport = new DaemonClientTransport(isAndroidApp, () => false, {
  connect: async () => {}, request: async () => { throw new Error("No daemon selected"); }, disconnect: async () => {},
});
export const daemonConnections = new DaemonConnections(preferences, (connectionId) => new DaemonClientTransport(
  isAndroidApp, () => !isMobileApp && isDaemonClient, {
    connect: async (credentials) => { await nativeRpc.request.daemonConnect({ ...credentials, connectionId }); },
    request: (request) => nativeRpc.request.daemonRequest({ ...request, connectionId }),
    disconnect: async () => { await nativeRpc.request.daemonDisconnect({ connectionId }); },
  },
));
if (!isMobileApp) nativeRpc.addMessageListener("event", (event) => {
  const parsed = parseBridgeEvent(event);
  if (parsed) daemonConnections.receive(parsed);
});
const uiEventListeners = new Map<UiBridgeEventListener, (event: BridgeEvent) => void>();
type ProviderRestoreState = { version: number; outcome: "ready" } | { version: number; outcome: "failed"; message: string };
type ProviderRestoreOutcome = { outcome: "ready" } | { outcome: "failed"; message: string };
type ProviderRestoreWaiter = { afterVersion: number; resolve(): void; reject(error: Error): void; timeout: number };
const providerRestoreStates = new Map<string, ProviderRestoreState>();
const providerRestoreWaiters = new Map<string, Set<ProviderRestoreWaiter>>();
const PROMPT_RECONNECT_TIMEOUT_MS = 90_000;

export function setAndroidStatusBarAppearance(light: boolean): void {
  daemonClientTransport.setStatusBarAppearance(light);
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

if (!isMobileApp) new Electroview({ rpc: nativeRpc });

export function connectDaemonBridge(endpoint: string, token: string, fingerprint: string): Promise<void> {
  return daemonConnections.add({ endpoint, token, fingerprint });
}

export function disconnectDaemonBridge(): void {
  for (const connection of daemonConnections.snapshot()) daemonConnections.disconnect(connection.id);
}

export function addUiBridgeEventListener(listener: UiBridgeEventListener): void {
  removeUiBridgeEventListener(listener);
  const onWireEvent = (wireEvent: BridgeEvent) => {
    const event = parseBridgeEvent(wireEvent);
    if (!event) return;
    for (const uiEvent of normalizeBridgeEvent(event)) listener(uiEvent);
  };
  uiEventListeners.set(listener, onWireEvent);
  if (isDaemonClient) daemonConnections.addEventListener(onWireEvent);
  else nativeRpc.addMessageListener("event", onWireEvent);
}

export function removeUiBridgeEventListener(listener: UiBridgeEventListener): void {
  const onWireEvent = uiEventListeners.get(listener);
  if (!onWireEvent) return;
  uiEventListeners.delete(listener);
  daemonConnections.removeEventListener(onWireEvent);
  if (!isMobileApp) nativeRpc.removeMessageListener("event", onWireEvent);
}

/** Mark the provider session ready after a daemon reconnect has restored its thread state. */
export function markDaemonProviderRestored(target: string, provider: AssistantProvider): void {
  updateProviderRestoreState(target, provider, { outcome: "ready" });
}

/** Report that a daemon reconnect could not restore the provider session. */
export function markDaemonProviderRestoreFailed(target: string, provider: AssistantProvider, message: string): void {
  updateProviderRestoreState(target, provider, { outcome: "failed", message });
}

/** Retry a prompt once after the daemon transport and provider session recover. */
export async function sendPromptWithDaemonRestartRecovery(
  params: DaemonApiRequestMap["sendPrompt"],
): Promise<DaemonApiResponseMap["sendPrompt"]> {
  if (!isDaemonClient) return bridgeRpc.request.sendPrompt(params);

  const provider = params.provider ?? activeAssistantProvider;
  const restoreKey = providerRestoreKey(params.target, provider);
  const restoreVersion = providerRestoreStates.get(restoreKey)?.version ?? 0;
  let disconnected = false;
  let turnStarted = false;
  let transportFailure: string | undefined;
  const onEvent: UiBridgeEventListener = (event) => {
    if (event.target !== params.target) return;
    if (event.type === "transportDisconnected") disconnected = true;
    else if (event.type === "transportFailed") transportFailure = event.message ?? "Hive 데몬에 다시 연결하지 못했습니다.";
    else if (event.type === "turnStarted" && event.target === params.target && event.threadId === params.threadId &&
        (!event.provider || event.provider === provider)) turnStarted = true;
  };

  addUiBridgeEventListener(onEvent);
  try {
    try {
      return await bridgeRpc.request.sendPrompt(params);
    } catch (error) {
      if (!disconnected) throw error;
      if (turnStarted) return { accepted: true };
      if (transportFailure) throw new Error(transportFailure);
      await waitForProviderRestore(restoreKey, restoreVersion);
      if (transportFailure) throw new Error(transportFailure);
      await bridgeRpc.request.openThread({
        target: params.target,
        threadId: params.threadId,
        provider,
        includeTranscript: false,
      });
      return await bridgeRpc.request.sendPrompt(params);
    }
  } finally {
    removeUiBridgeEventListener(onEvent);
  }
}

function updateProviderRestoreState(
  target: string,
  provider: AssistantProvider,
  state: ProviderRestoreOutcome,
): void {
  const key = providerRestoreKey(target, provider);
  const next: ProviderRestoreState = { ...state, version: (providerRestoreStates.get(key)?.version ?? 0) + 1 };
  providerRestoreStates.set(key, next);
  const waiters = providerRestoreWaiters.get(key);
  if (!waiters) return;
  for (const waiter of [...waiters]) {
    if (waiter.afterVersion >= next.version) continue;
    window.clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    if (next.outcome === "ready") waiter.resolve();
    else waiter.reject(new Error(next.message));
  }
  if (waiters.size === 0) providerRestoreWaiters.delete(key);
}

function waitForProviderRestore(key: string, afterVersion: number): Promise<void> {
  const current = providerRestoreStates.get(key);
  if (current && current.version > afterVersion) {
    return current.outcome === "ready" ? Promise.resolve() : Promise.reject(new Error(current.message));
  }
  return new Promise((resolve, reject) => {
    const waiters = providerRestoreWaiters.get(key) ?? new Set<ProviderRestoreWaiter>();
    const waiter: ProviderRestoreWaiter = {
      afterVersion,
      resolve,
      reject,
      timeout: window.setTimeout(() => {
        waiters.delete(waiter);
        if (waiters.size === 0) providerRestoreWaiters.delete(key);
        reject(new Error("Hive 데몬 연결은 복구됐지만 provider 세션 준비를 기다리는 시간이 초과됐습니다."));
      }, PROMPT_RECONNECT_TIMEOUT_MS),
    };
    waiters.add(waiter);
    providerRestoreWaiters.set(key, waiters);
  });
}

function providerRestoreKey(target: string, provider: AssistantProvider): string {
  return target + "\u0000" + provider;
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
          const nativeDesktopDaemon = !isMobileApp && isDaemonClient;
          if (nativeDesktopDaemon && ["windowAction", "getHostPlatform", "getGtkSettings", "getWindowFrame", "setWindowFrame", "daemonConnect", "daemonRequest", "daemonDisconnect", "chooseWorkspaceFolder"].includes(method)) {
            return Reflect.get(requests, method);
          }
          if (!isMobileApp && !nativeDesktopDaemon) {
            return includeProvider && request ? (params: unknown) => request(injectProvider(params)) : request;
          }
          return (params: unknown) => daemonConnections.request(method, injectProvider(params));
        },
      });
    }
    if (property === "addMessageListener") {
      if (!isDaemonClient) return Reflect.get(target, property, receiver);
      return (_name: string, listener: (event: BridgeEvent) => void) => daemonConnections.addEventListener(listener);
    }
    if (property === "removeMessageListener") {
      if (!isDaemonClient) return Reflect.get(target, property, receiver);
      return (_name: string, listener: (event: BridgeEvent) => void) => daemonConnections.removeEventListener(listener);
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
    return mode === null ? isLinuxDesktop : mode !== "direct";
  } catch {
    return isLinuxDesktop;
  }
}
