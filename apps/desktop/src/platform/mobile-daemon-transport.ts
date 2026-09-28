import { parseBridgeEvent, type BridgeEvent } from "../../../../src/interfaces/contracts/daemon-events.js";
import { parseDaemonApiRequest, type DaemonApiRequest } from "../../../../src/interfaces/contracts/daemon-api.js";
import { MobileDaemonRpcChannel } from "./mobile-daemon-rpc";
import { MobileDaemonSocket, type MobileBridgeCredentials } from "./mobile-daemon-socket";
type BridgeEventListener = (event: BridgeEvent) => void;
export type NativeDaemonBridge = {
  connect(credentials: MobileBridgeCredentials): Promise<void>;
  request(request: DaemonApiRequest): Promise<unknown>;
  disconnect(): Promise<void>;
};

/** Own WSS authentication, TLS pinning, reconnects, and mobile daemon request framing. */
export class MobileDaemonTransport {
  private readonly socket: MobileDaemonSocket;
  private readonly rpc = new MobileDaemonRpcChannel();
  private readonly eventListeners = new Set<BridgeEventListener>();
  private credentials: MobileBridgeCredentials | undefined;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private reconnectInFlight = false;
  private connected = false;
  private reconnectStopped = true;

  constructor(
    private readonly android: boolean,
    private readonly useNativeDaemon: () => boolean,
    private readonly nativeDaemon: NativeDaemonBridge,
  ) {
    this.socket = new MobileDaemonSocket(android);
  }

  setStatusBarAppearance(light: boolean): void {
    this.socket.setStatusBarAppearance(light);
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
    const credentials = this.normalizeCredentials(endpoint, token, fingerprint);
    if (credentials instanceof Error) return Promise.reject(credentials);
    this.credentials = credentials;
    this.reconnectStopped = false;
    this.reconnectAttempt = 0;
    window.addEventListener("online", this.handleNetworkAvailable);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
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

  private normalizeCredentials(endpoint: string, token: string, fingerprint: string): MobileBridgeCredentials | Error {
    let url: URL;
    try {
      url = new URL(endpoint.trim());
    } catch {
      return new Error("데몬 주소를 wss:// 형식으로 입력하세요.");
    }
    if (url.protocol !== "wss:") return new Error("데몬 연결에는 암호화된 wss:// 주소가 필요합니다.");
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/rpc";
    if (url.pathname !== "/rpc" || url.search || url.hash || url.username || url.password) {
      return new Error("데몬 주소에는 /rpc 경로만 사용할 수 있습니다.");
    }
    const certificatePin = fingerprint.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
    if ((this.android || this.useNativeDaemon()) && !/^[a-f0-9]{64}$/.test(certificatePin)) {
      return new Error("데몬이 출력한 SHA-256 인증서 지문 64자리를 입력하세요.");
    }
    if (!token.trim()) return new Error("데몬 페어링 토큰을 입력하세요.");
    return { endpoint: url.toString(), token: token.trim(), fingerprint: certificatePin };
  }

  private openConnection(credentials: MobileBridgeCredentials): Promise<void> {
    if (this.useNativeDaemon()) {
      return this.nativeDaemon.connect(credentials).then(() => { this.connected = true; });
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error("Hive 데몬에 연결하지 못했습니다. 주소와 네트워크를 확인하세요.")), 15_000);
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (error) {
          this.socket.close();
          this.clearTransport();
          reject(error);
        } else {
          this.connected = true;
          resolve();
        }
      };
      void this.socket.connect(credentials, {
        open: () => {
          void Promise.resolve(this.socket.send(JSON.stringify({ type: "authenticate", token: credentials.token })))
            .catch((error: unknown) => finish(asError(error)));
        },
        message: (data) => this.receiveMessage(data, credentials, finish),
        error: (message) => {
          if (!settled) finish(new Error(message));
          else if (this.android) this.handleUnexpectedDisconnect(message || "Hive 데몬 연결 오류입니다.");
        },
        close: (code, closeReason) => {
          const reason = code === 1008 ? "페어링 토큰을 확인하세요." : closeReason || "Hive 데몬 연결이 종료되었습니다.";
          if (!settled) finish(new Error(reason));
          else this.handleUnexpectedDisconnect(reason, code !== 1008);
        },
      }).catch((error: unknown) => finish(asError(error)));
    });
  }

  private receiveMessage(data: string, credentials: MobileBridgeCredentials, finish: (error?: Error) => void): void {
    let packet: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!isRecord(parsed)) return;
      packet = parsed;
    } catch {
      return;
    }
    if (packet.type === "authenticated") {
      finish();
      if (this.android && !this.reconnectStopped && this.credentials === credentials) {
        void this.socket.setKeepAlive(true).catch((error: unknown) => {
          this.notifyTransport("hive/transport/keepalive-failed", asError(error).message);
        });
      }
    } else if (packet.type === "event") {
      const event = parseBridgeEvent(packet.event);
      if (event) this.publish(event);
    } else if (this.rpc.receivePacket(packet)) {
      return;
    } else if (packet.type === "error" && typeof packet.error === "string") {
      finish(new Error(packet.error));
    }
  }

  private stopReconnect(clearCredentials: boolean): void {
    this.reconnectStopped = true;
    if (clearCredentials) this.credentials = undefined;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    window.removeEventListener("online", this.handleNetworkAvailable);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private handleUnexpectedDisconnect(reason: string, retry = true): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.clearTransport();
    this.rpc.rejectAll(reason);
    if (!wasConnected || this.reconnectStopped || !this.credentials) return;
    this.notifyTransport("hive/transport/disconnected", reason);
    if (retry) this.scheduleReconnect();
    else {
      this.stopReconnect(false);
      if (this.android) void this.socket.setKeepAlive(false).catch(() => {});
      this.notifyTransport("hive/transport/failed", reason);
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectStopped || !this.credentials || this.connected || this.reconnectInFlight) return;
    if (this.reconnectTimer !== null) {
      if (delayMs !== 0) return;
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const delay = delayMs ?? Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    if (delayMs === undefined) this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      const credentials = this.credentials;
      if (this.reconnectStopped || !credentials || this.connected || this.reconnectInFlight) return;
      this.reconnectInFlight = true;
      void this.openConnection(credentials).then(() => {
        this.reconnectInFlight = false;
        if (this.reconnectStopped || this.credentials !== credentials) return;
        if (!this.connected) {
          this.scheduleReconnect();
          return;
        }
        this.reconnectAttempt = 0;
        this.notifyTransport("hive/transport/reconnected");
      }).catch((error: unknown) => {
        this.reconnectInFlight = false;
        if (this.reconnectStopped || this.credentials !== credentials) return;
        const message = asError(error).message;
        if (/페어링 토큰|certificate.*(mismatch|invalid|does not match)|fingerprint.*(mismatch|does not match)/i.test(message)) {
          this.stopReconnect(false);
          if (this.android) void this.socket.setKeepAlive(false).catch(() => {});
          this.notifyTransport("hive/transport/failed", message);
          return;
        }
        this.scheduleReconnect();
      });
    }, delay);
  }

  private handleNetworkAvailable = (): void => this.scheduleReconnect(0);

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") this.scheduleReconnect(0);
  };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
