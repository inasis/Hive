import { normalizeDaemonCredentials } from "../../../../src/infrastructure/transport/daemon-credentials.js";
import { DaemonReconnectPolicy } from "../../../../src/infrastructure/transport/daemon-reconnect-policy.js";
import type { BridgeEvent } from "../../../../src/presentation/shared/bridge.js";
import { BunDaemonRpcChannel } from "./daemon-rpc.js";
import { PinnedDaemonWssSession } from "./pinned-daemon-wss-session.js";

export type DaemonCredentials = {
  endpoint: string;
  token: string;
  fingerprint: string;
};

/** WSS client for the daemon endpoint, pinned to the certificate fingerprint shown by the daemon. */
export class PinnedDaemonClient {
  private session?: PinnedDaemonWssSession;
  private connected = false;
  private manuallyClosed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnecting = false;
  private credentials?: DaemonCredentials;
  private readonly reconnectPolicy = new DaemonReconnectPolicy();
  private readonly rpc: BunDaemonRpcChannel;

  constructor(private readonly onEvent: (event: BridgeEvent) => void) {
    this.rpc = new BunDaemonRpcChannel({
      isOpen: () => this.connected && Boolean(this.session?.isOpen()),
      send: (data, callback) => {
        const session = this.session;
        if (!session) {
          callback(new Error("Hive 데몬 연결이 끊어졌습니다. 연결 설정을 확인하세요."));
          return;
        }
        session.send(data, callback);
      },
    });
  }

  connect(credentials: DaemonCredentials): Promise<void> {
    if (this.session?.isConnectingOrOpen()) {
      return Promise.reject(new Error("A Hive daemon connection is already open"));
    }

    let normalized: DaemonCredentials;
    try {
      normalized = normalizeDaemonCredentials(credentials);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.credentials = normalized;
    this.reconnectPolicy.reset();
    this.clearReconnectTimer();
    this.manuallyClosed = false;
    return this.openConnection(normalized);
  }

  private openConnection(normalized: DaemonCredentials): Promise<void> {
    this.manuallyClosed = false;
    let session: PinnedDaemonWssSession;
    session = new PinnedDaemonWssSession(normalized, {
      onAuthenticated: () => { this.connected = true; },
      onEvent: (event) => this.onEvent(event),
      onResponse: (packet) => this.rpc.receiveResponse(packet),
      onClose: (reason, wasAuthenticated) => {
        this.connected = false;
        if (this.session === session) this.session = undefined;
        this.rpc.rejectAll(reason);
        if (wasAuthenticated && !this.manuallyClosed) {
          this.onEvent({ target: "", threadId: "", method: "hive/transport/disconnected", params: { message: reason } });
          this.scheduleReconnect();
        }
      },
    });
    const connection = session.connect();
    this.session = session;
    return connection;
  }

  request(method: string, params: unknown): Promise<unknown> {
    return this.rpc.request(method, params);
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.credentials = undefined;
    this.clearReconnectTimer();
    this.reconnecting = false;
    this.connected = false;
    this.rpc.rejectAll("Hive 데몬 연결을 종료했습니다.");
    const session = this.session;
    this.session = undefined;
    session?.close();
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || !this.credentials || this.reconnecting || this.reconnectTimer) return;
    const delay = this.reconnectPolicy.nextDelayMs();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      const credentials = this.credentials;
      if (this.manuallyClosed || !credentials || this.reconnecting || this.connected) return;
      this.reconnecting = true;
      void this.openConnection(credentials).then(() => {
        this.reconnecting = false;
        this.reconnectPolicy.reset();
        this.onEvent({ target: "", threadId: "", method: "hive/transport/reconnected", params: {} });
      }).catch((error: unknown) => {
        this.reconnecting = false;
        if (this.manuallyClosed || this.credentials !== credentials) return;
        const message = error instanceof Error ? error.message : String(error);
        if (this.reconnectPolicy.isCredentialFailure(message)) {
          this.credentials = undefined;
          this.onEvent({ target: "", threadId: "", method: "hive/transport/failed", params: { message } });
          return;
        }
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

}
