import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { Electroview } from "electrobun/view";
import { isDaemonApiMethod } from "../../../../src/daemon-api-contract";
import { isAssistantProvider } from "../../../../src/domain/provider-catalog.js";
import type { AssistantProvider, BridgeEvent, HiveBridgeSchema } from "../shared/bridge";

type BridgeEventListener = (event: BridgeEvent) => void;
type HiveTransportPlugin = {
  connect(options: { url: string; fingerprint: string }): Promise<void>;
  send(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
  setKeepAlive(options: { enabled: boolean }): Promise<void>;
  setStatusBarAppearance(options: { light: boolean }): Promise<void>;
  addListener(event: "message", listener: (event: { data: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "error", listener: (event: { message: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "close", listener: (event: { code: number; reason: string }) => void): Promise<PluginListenerHandle>;
};
type MobileBridgeCredentials = { endpoint: string; token: string; fingerprint: string };

const nativeRpc = Electroview.defineRPC<HiveBridgeSchema>({
  handlers: { requests: {}, messages: {} },
});
const hiveTransport = registerPlugin<HiveTransportPlugin>("HiveTransport");

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
const DESKTOP_CONNECTION_MODE_KEY = "hive.desktop.connectionMode.v1";
const ASSISTANT_PROVIDER_KEY = "hive.assistantProvider.v1";
const MOBILE_REQUEST_TIMEOUT_MS = 60_000;
const PROVIDER_REQUESTS = new Set([
  "connect", "refresh", "createThread", "renameThread", "deleteThread", "openThread", "forkSideThread", "forkThread",
  "listSkills", "listCommands", "runCommand", "sendPrompt", "steerTurn", "interruptTurn", "updateThreadSettings", "disconnect", "answerApproval",
]);
let activeAssistantProvider: AssistantProvider = readAssistantProvider();
export let isDaemonClient = isMobileApp || (isLinuxDesktop && readDesktopDaemonMode());
const isAndroidApp = isMobileApp && window.Capacitor?.getPlatform?.() === "android";

export function setAndroidStatusBarAppearance(light: boolean): void {
  if (!isAndroidApp) return;
  void hiveTransport.setStatusBarAppearance({ light }).catch(() => {});
}

export function setLinuxDaemonMode(enabled: boolean): void {
  if (!isLinuxDesktop) return;
  isDaemonClient = enabled;
  try {
    localStorage.setItem(DESKTOP_CONNECTION_MODE_KEY, enabled ? "daemon" : "direct");
    if (!enabled && localStorage.getItem("hive.sshTarget") === "hive-local://") {
      localStorage.removeItem("hive.sshTarget");
    }
  } catch {}
}

export function setAssistantProvider(provider: AssistantProvider): void {
  activeAssistantProvider = provider;
  try { localStorage.setItem(ASSISTANT_PROVIDER_KEY, provider); } catch {}
}

if (!isMobileApp) new Electroview({ rpc: nativeRpc });

let mobileSocket: WebSocket | undefined;
let mobileSend: ((data: string) => void | Promise<void>) | undefined;
let mobileClose: (() => void) | undefined;
let nativeListenerHandles: PluginListenerHandle[] = [];
let nextMobileRequestId = 1;
const pendingMobileRequests = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
}>();
const mobileEventListeners = new Set<BridgeEventListener>();
let mobileCredentials: MobileBridgeCredentials | undefined;
let mobileReconnectTimer: number | null = null;
let mobileReconnectAttempt = 0;
let mobileReconnectInFlight = false;
let mobileTransportConnected = false;
let mobileReconnectStopped = true;

function requestMobileBridge(method: string, params: unknown): Promise<unknown> {
  if (!isDaemonApiMethod(method)) return Promise.reject(new Error("Unsupported daemon request"));
  if (isLinuxDesktop && isDaemonClient) {
    if (!mobileTransportConnected) {
      return Promise.reject(new Error("Hive 데몬 연결이 끊어졌습니다. 연결 설정을 확인하세요."));
    }
    return nativeRpc.request.daemonRequest({ method, params });
  }
  if (!mobileTransportConnected || !mobileSend || (mobileSocket && mobileSocket.readyState !== WebSocket.OPEN)) {
    return Promise.reject(new Error("Hive 데몬 연결이 끊어졌습니다. 기기 연결 설정을 확인하세요."));
  }
  const id = nextMobileRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingMobileRequests.delete(id);
      reject(new Error("Hive 데몬 응답이 60초 동안 없습니다. 연결 상태와 세션 목록을 확인한 뒤 다시 시도하세요."));
    }, MOBILE_REQUEST_TIMEOUT_MS);
    pendingMobileRequests.set(id, { resolve, reject, timeout });
    try {
      void Promise.resolve(mobileSend!(JSON.stringify({ type: "request", id, method, params }))).catch((error: unknown) => {
        const pending = pendingMobileRequests.get(id);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingMobileRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      const pending = pendingMobileRequests.get(id);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      pendingMobileRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Connect the Android WebView to the Hive daemon, pinning its local TLS certificate on Android. */
export function connectMobileBridge(endpoint: string, token: string, fingerprint: string): Promise<void> {
  disconnectMobileBridge();
  const credentials = normalizeMobileCredentials(endpoint, token, fingerprint);
  if (credentials instanceof Error) return Promise.reject(credentials);
  mobileCredentials = credentials;
  mobileReconnectStopped = false;
  mobileReconnectAttempt = 0;
  window.addEventListener("online", handleMobileNetworkAvailable);
  document.addEventListener("visibilitychange", handleMobileVisibilityChange);
  mobileReconnectInFlight = true;
  return openMobileBridgeConnection(credentials).then(() => {
    mobileReconnectInFlight = false;
    if (mobileCredentials === credentials && !mobileTransportConnected) scheduleMobileReconnect();
  }).catch((error: unknown) => {
    mobileReconnectInFlight = false;
    if (mobileCredentials === credentials && !mobileTransportConnected) {
      stopMobileReconnect(true);
      if (isAndroidApp) void hiveTransport.setKeepAlive({ enabled: false }).catch(() => {});
    }
    throw error;
  });
}

function normalizeMobileCredentials(endpoint: string, token: string, fingerprint: string): MobileBridgeCredentials | Error {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return new Error("데몬 주소를 wss:// 형식으로 입력하세요.");
  }
  if (url.protocol !== "wss:") {
    return new Error("데몬 연결에는 암호화된 wss:// 주소가 필요합니다.");
  }
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/rpc";
  if (url.pathname !== "/rpc" || url.search || url.hash || url.username || url.password) {
    return new Error("데몬 주소에는 /rpc 경로만 사용할 수 있습니다.");
  }
  const certificatePin = fingerprint.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if ((isAndroidApp || (isLinuxDesktop && isDaemonClient)) && !/^[a-f0-9]{64}$/.test(certificatePin)) {
    return new Error("데몬이 출력한 SHA-256 인증서 지문 64자리를 입력하세요.");
  }
  if (!token.trim()) return new Error("데몬 페어링 토큰을 입력하세요.");
  return { endpoint: url.toString(), token: token.trim(), fingerprint: certificatePin };
}

function openMobileBridgeConnection(credentials: MobileBridgeCredentials): Promise<void> {
  if (isLinuxDesktop && isDaemonClient) {
    return nativeRpc.request.daemonConnect(credentials).then(() => {
      mobileTransportConnected = true;
    });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error("Hive 데몬에 연결하지 못했습니다. 주소와 네트워크를 확인하세요.")), 15_000);
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (error) {
        mobileClose?.();
        clearMobileTransport();
        reject(error);
      } else {
        mobileTransportConnected = true;
        resolve();
      }
    };
    const handleMessage = (data: string): void => {
      let packet: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
        packet = parsed as Record<string, unknown>;
      } catch {
        return;
      }
      if (packet.type === "authenticated") {
        finish();
        if (isAndroidApp && !mobileReconnectStopped && mobileCredentials === credentials) {
          void hiveTransport.setKeepAlive({ enabled: true }).catch((error: unknown) => {
            notifyMobileTransport("hive/transport/keepalive-failed", error instanceof Error ? error.message : String(error));
          });
        }
      } else if (packet.type === "event") {
        for (const listener of mobileEventListeners) listener(packet.event as BridgeEvent);
      } else if (packet.type === "response" && (typeof packet.id === "number" || typeof packet.id === "string")) {
        const id = Number(packet.id);
        const pending = pendingMobileRequests.get(id);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingMobileRequests.delete(id);
        if (typeof packet.error === "string") pending.reject(new Error(packet.error));
        else pending.resolve(packet.result);
      } else if (packet.type === "error" && typeof packet.error === "string") {
        finish(new Error(packet.error));
      }
    };
    const sendAuthentication = (): void => {
      if (!mobileSend) {
        finish(new Error("Hive 데몬 연결이 끊어졌습니다."));
        return;
      }
      void Promise.resolve(mobileSend(JSON.stringify({ type: "authenticate", token: credentials.token })))
        .catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
    };

    if (isAndroidApp) {
      void (async () => {
        try {
          await hiveTransport.disconnect();
          nativeListenerHandles = await Promise.all([
            hiveTransport.addListener("message", ({ data }) => handleMessage(data)),
            hiveTransport.addListener("error", ({ message }) => {
              if (!settled) finish(new Error(message));
              else handleUnexpectedMobileDisconnect(message || "Hive 데몬 연결 오류입니다.");
            }),
            hiveTransport.addListener("close", ({ code, reason }) => {
              if (!settled) finish(new Error(code === 1008 ? "페어링 토큰을 확인하세요." : reason || "Hive 데몬 연결이 종료되었습니다."));
              else handleUnexpectedMobileDisconnect(code === 1008 ? "페어링 토큰을 확인하세요." : reason || "Hive 데몬 연결이 종료되었습니다.", code !== 1008);
            }),
          ]);
          mobileClose = () => { void hiveTransport.disconnect(); };
          await hiveTransport.connect({ url: credentials.endpoint, fingerprint: credentials.fingerprint });
          mobileSend = (data) => hiveTransport.send({ data });
          sendAuthentication();
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      })();
      return;
    }

    const socket = new WebSocket(credentials.endpoint);
    mobileSocket = socket;
    mobileSend = (data) => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error("Hive daemon WebSocket is not open");
      socket.send(data);
    };
    mobileClose = () => { if (socket.readyState < WebSocket.CLOSING) socket.close(); };
    socket.onopen = sendAuthentication;
    socket.onmessage = (message) => { if (typeof message.data === "string") handleMessage(message.data); };
    socket.onerror = () => finish(new Error("Hive 데몬 연결 오류입니다. 주소와 네트워크를 확인하세요."));
    socket.onclose = (event) => {
      const reason = event.code === 1008 ? "페어링 토큰을 확인하세요." : event.reason || "Hive 데몬 연결이 종료되었습니다.";
      if (!settled) finish(new Error(reason));
      else handleUnexpectedMobileDisconnect(reason, event.code !== 1008);
    };
  });
}

export function disconnectMobileBridge(): void {
  stopMobileReconnect(true);
  mobileReconnectInFlight = false;
  mobileTransportConnected = false;
  mobileClose?.();
  if (isAndroidApp) {
    void hiveTransport.disconnect();
    void hiveTransport.setKeepAlive({ enabled: false }).catch(() => {});
  }
  if (isLinuxDesktop && isDaemonClient) void nativeRpc.request.daemonDisconnect({}).catch(() => {});
  clearMobileTransport();
  rejectPendingRequests("Hive 데몬 연결을 종료했습니다.");
}

function stopMobileReconnect(clearCredentials: boolean): void {
  mobileReconnectStopped = true;
  if (clearCredentials) mobileCredentials = undefined;
  mobileReconnectAttempt = 0;
  if (mobileReconnectTimer !== null) {
    window.clearTimeout(mobileReconnectTimer);
    mobileReconnectTimer = null;
  }
  window.removeEventListener("online", handleMobileNetworkAvailable);
  document.removeEventListener("visibilitychange", handleMobileVisibilityChange);
}

function handleUnexpectedMobileDisconnect(reason: string, retry = true): void {
  const wasConnected = mobileTransportConnected;
  mobileTransportConnected = false;
  clearMobileTransport();
  rejectPendingRequests(reason);
  if (!wasConnected || mobileReconnectStopped || !mobileCredentials) return;
  notifyMobileTransport("hive/transport/disconnected", reason);
  if (retry) scheduleMobileReconnect();
  else {
    stopMobileReconnect(false);
    if (isAndroidApp) void hiveTransport.setKeepAlive({ enabled: false }).catch(() => {});
    notifyMobileTransport("hive/transport/failed", reason);
  }
}

function scheduleMobileReconnect(delayMs?: number): void {
  if (mobileReconnectStopped || !mobileCredentials || mobileTransportConnected || mobileReconnectInFlight) return;
  if (mobileReconnectTimer !== null) {
    if (delayMs !== 0) return;
    window.clearTimeout(mobileReconnectTimer);
    mobileReconnectTimer = null;
  }
  const delay = delayMs ?? Math.min(30_000, 1_000 * 2 ** Math.min(mobileReconnectAttempt, 5));
  if (delayMs === undefined) mobileReconnectAttempt += 1;
  mobileReconnectTimer = window.setTimeout(() => {
    mobileReconnectTimer = null;
    const credentials = mobileCredentials;
    if (mobileReconnectStopped || !credentials || mobileTransportConnected || mobileReconnectInFlight) return;
    mobileReconnectInFlight = true;
    void openMobileBridgeConnection(credentials).then(() => {
      mobileReconnectInFlight = false;
      if (mobileReconnectStopped || mobileCredentials !== credentials) return;
      if (!mobileTransportConnected) {
        scheduleMobileReconnect();
        return;
      }
      mobileReconnectAttempt = 0;
      notifyMobileTransport("hive/transport/reconnected");
    }).catch((error: unknown) => {
      mobileReconnectInFlight = false;
      if (mobileReconnectStopped || mobileCredentials !== credentials) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/페어링 토큰|certificate.*(mismatch|invalid|does not match)|fingerprint.*(mismatch|does not match)/i.test(message)) {
        stopMobileReconnect(false);
        if (isAndroidApp) void hiveTransport.setKeepAlive({ enabled: false }).catch(() => {});
        notifyMobileTransport("hive/transport/failed", message);
        return;
      }
      scheduleMobileReconnect();
    });
  }, delay);
}

function handleMobileNetworkAvailable(): void {
  scheduleMobileReconnect(0);
}

function handleMobileVisibilityChange(): void {
  if (document.visibilityState === "visible") scheduleMobileReconnect(0);
}

function notifyMobileTransport(method: string, message?: string): void {
  const event: BridgeEvent = { target: "", threadId: "", method, params: message ? { message } : {} };
  for (const listener of mobileEventListeners) listener(event);
}

function clearMobileTransport(): void {
  mobileTransportConnected = false;
  const socket = mobileSocket;
  mobileSocket = undefined;
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  mobileSend = undefined;
  mobileClose = undefined;
  for (const handle of nativeListenerHandles) void handle.remove();
  nativeListenerHandles = [];
}

function rejectPendingRequests(message: string): void {
  for (const [id, pending] of pendingMobileRequests) {
    window.clearTimeout(pending.timeout);
    pending.reject(new Error(message));
    pendingMobileRequests.delete(id);
  }
}

export const bridgeRpc = new Proxy(nativeRpc, {
  get(target, property, receiver) {
    if (property === "request") {
      return new Proxy(target.request, {
        get(requests, method) {
          if (typeof method !== "string") return Reflect.get(requests, method);
          const request = Reflect.get(requests, method) as ((params: unknown) => unknown) | undefined;
          const includeProvider = PROVIDER_REQUESTS.has(method);
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
          return (params: unknown) => requestMobileBridge(method, injectProvider(params));
        },
      });
    }
    if (property === "addMessageListener") {
      if (!isMobileApp) return Reflect.get(target, property, receiver);
      return (_name: string, listener: BridgeEventListener) => mobileEventListeners.add(listener);
    }
    if (property === "removeMessageListener") {
      if (!isMobileApp) return Reflect.get(target, property, receiver);
      return (_name: string, listener: BridgeEventListener) => mobileEventListeners.delete(listener);
    }
    return Reflect.get(target, property, receiver);
  },
}) as typeof nativeRpc;

function readAssistantProvider(): AssistantProvider {
  try {
    const value = localStorage.getItem(ASSISTANT_PROVIDER_KEY);
    return isAssistantProvider(value) ? value : "codex";
  }
  catch { return "codex"; }
}

function readDesktopDaemonMode(): boolean {
  try {
    return localStorage.getItem(DESKTOP_CONNECTION_MODE_KEY) !== "direct";
  } catch {
    return true;
  }
}
