import type { BridgeEvent } from "../../../../src/application/dto/daemon/daemon-events.js";
import { parseDaemonApiRequest } from "../../../../src/application/dto/daemon/daemon-request.js";
import type { DaemonApiRequest } from "../../../../src/application/dto/daemon/daemon-api.js";
import { normalizeDaemonCredentials } from "../../../../src/infrastructure/transport/daemon-credentials.js";
import { DaemonClientReconnectScheduler } from "./daemon-client-reconnect-scheduler";
import type { NotificationPermissionPort } from "./mobile-device";
import { DaemonClientWssSession } from "./daemon-client-wss-session";
import { DaemonRpcChannel } from "./daemon-rpc-channel";
import { DaemonWssSocket, type DaemonWssCredentials } from "./daemon-wss-socket";
type BridgeEventListener = (event: BridgeEvent) => void;
export type NativeDaemonBridge = {
  connect(credentials: DaemonWssCredentials): Promise<void>;
  request(request: DaemonApiRequest): Promise<unknown>;
  disconnect(): Promise<void>;
};

/** Own daemon pairing, WSS authentication, reconnects, and Android/native desktop request routing. */
export class DaemonClientTransport {
  private readonly socket: DaemonWssSocket;
  private readonly wssSession: DaemonClientWssSession;
  private readonly rpc = new DaemonRpcChannel();
  private readonly eventListeners = new Set<BridgeEventListener>();
  private readonly reconnect: DaemonClientReconnectScheduler;
  private credentials: DaemonWssCredentials | undefined;
  private reconnectInFlight = false;
  private connected = false;

  constructor(
    private readonly android: boolean,
    private readonly useNativeDaemon: () => boolean,
    private readonly nativeDaemon: NativeDaemonBridge,
    private readonly notificationPermission: NotificationPermissionPort,
  ) {
    this.socket = new DaemonWssSocket(android, () => { void this.notificationPermission.requestNotifications().catch(() => {}); });
    this.reconnect = new DaemonClientReconnectScheduler(() => this.scheduleReconnect(0));
    this.wssSession = new DaemonClientWssSession(android, this.socket, {
      onAuthenticated: () => { this.connected = true; },
      shouldEnableKeepAlive: (credentials) => !this.reconnect.isStopped() && this.credentials === credentials,
      onKeepAliveFailure: (message) => this.notifyTransport("hive/transport/keepalive-failed", message),
      onResume: (credentials) => {
        if (!this.android || this.reconnect.isStopped() || this.credentials !== credentials) return;
        if (this.connected) this.handleUnexpectedDisconnect("앱이 다시 활성화되어 데몬 연결을 복구합니다.", true, 0);
        else this.scheduleReconnect(0);
      },
      onEvent: (event) => this.publish(event),
      onResponse: (packet) => this.rpc.receivePacket(packet),
      pendingMethods: () => this.rpc.pendingMethods(),
      onUnexpectedDisconnect: (reason, retry) => this.handleUnexpectedDisconnect(reason, retry),
    });
  }

  addEventListener(listener: BridgeEventListener): void {
    this.eventListeners.add(listener);
  }

  removeEventListener(listener: BridgeEventListener): void {
    this.eventListeners.delete(listener);
  }

  request(method: string, params: unknown): Promise<unknown> {
    let request: DaemonApiRequest;
    try {
      request = parseDaemonApiRequest(method, params);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    if (this.useNativeDaemon()) {
      if (!this.connected) return Promise.reject(new Error("Hive 데몬 연결이 끊어졌습니다. 연결 설정을 확인하세요."));
      return this.nativeDaemon.request(request);
    }
    if (!this.connected || !this.socket.canSend()) {
      return Promise.reject(new Error("Hive 데몬 연결이 끊어졌습니다. 기기 연결 설정을 확인하세요."));
    }
    return this.rpc.request(request, (data) => this.socket.send(data));
  }

  connect(endpoint: string, token: string, fingerprint: string): Promise<void> {
    this.disconnect();
    let credentials: DaemonWssCredentials;
    try {
      credentials = normalizeDaemonCredentials(
        { endpoint, token, fingerprint },
        { requireFingerprint: this.android || this.useNativeDaemon() },
      );
    } catch (error) {
      return Promise.reject(asError(error));
    }
    this.credentials = credentials;
    this.reconnect.start();
    this.reconnectInFlight = true;
    return this.openConnection(credentials).then(() => {
      this.reconnectInFlight = false;
      if (this.credentials === credentials && !this.connected) this.scheduleReconnect();
    }).catch((error: unknown) => {
      this.reconnectInFlight = false;
      if (this.credentials === credentials && !this.connected) {
        this.stopReconnect(true);
        if (this.android) void this.socket.setKeepAlive(false).catch(() => {});
      }
      throw error;
    });
  }

  disconnect(): void {
    this.stopReconnect(true);
    this.reconnectInFlight = false;
    this.connected = false;
    this.socket.disconnect();
    if (this.android) void this.socket.setKeepAlive(false).catch(() => {});
    if (this.useNativeDaemon()) void this.nativeDaemon.disconnect().catch(() => {});
    this.clearTransport();
    this.rpc.rejectAll("Hive 데몬 연결을 종료했습니다.");
  }

  private openConnection(credentials: DaemonWssCredentials): Promise<void> {
    if (this.useNativeDaemon()) {
      return this.nativeDaemon.connect(credentials).then(() => { this.connected = true; });
    }
    return this.wssSession.connect(credentials);
  }

  private stopReconnect(clearCredentials: boolean): void {
    if (clearCredentials) this.credentials = undefined;
    this.reconnect.stop();
  }

  private handleUnexpectedDisconnect(reason: string, retry = true, retryDelayMs?: number): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.clearTransport();
    this.rpc.rejectAll(reason);
    if (!wasConnected || this.reconnect.isStopped() || !this.credentials) return;
    this.notifyTransport("hive/transport/disconnected", reason);
    if (retry) this.scheduleReconnect(retryDelayMs);
    else {
      this.stopReconnect(false);
      if (this.android) void this.socket.setKeepAlive(false).catch(() => {});
      this.notifyTransport("hive/transport/failed", reason);
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    this.reconnect.schedule(
      () => Boolean(this.credentials) && !this.connected && !this.reconnectInFlight,
      () => this.reconnectNow(),
      delayMs,
    );
  }

  private reconnectNow(): void {
    const credentials = this.credentials;
    if (this.reconnect.isStopped() || !credentials || this.connected || this.reconnectInFlight) return;
    this.reconnectInFlight = true;
    void this.openConnection(credentials).then(() => {
      this.reconnectInFlight = false;
      if (this.reconnect.isStopped() || this.credentials !== credentials) return;
      if (!this.connected) {
        this.scheduleReconnect();
        return;
      }
      this.reconnect.resetPolicy();
      this.notifyTransport("hive/transport/reconnected");
    }).catch((error: unknown) => {
      this.reconnectInFlight = false;
      if (this.reconnect.isStopped() || this.credentials !== credentials) return;
      const message = asError(error).message;
      if (this.reconnect.isCredentialFailure(message)) {
        this.stopReconnect(false);
        if (this.android) void this.socket.setKeepAlive(false).catch(() => {});
        this.notifyTransport("hive/transport/failed", message);
        return;
      }
      this.scheduleReconnect();
    });
  }

  private notifyTransport(method: string, message?: string): void {
    this.publish({ target: "", threadId: "", method, params: message ? { message } : {} });
  }

  private publish(event: BridgeEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private clearTransport(): void {
    this.socket.reset();
  }

}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
