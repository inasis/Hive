import { createHash, timingSafeEqual } from "node:crypto";
import type { TLSSocket } from "node:tls";
import WebSocket, { type RawData } from "ws";
import { parseBridgeEvent } from "../../../../src/interfaces/contracts/daemon-events.js";
import type { BridgeEvent } from "../shared/bridge.js";
import { BunDaemonRpcChannel } from "./daemon-rpc.js";

const MAX_DAEMON_MESSAGE_BYTES = 16 * 1024 * 1024;

export type DaemonCredentials = {
  endpoint: string;
  token: string;
  fingerprint: string;
};

type TlsWebSocket = WebSocket & {
  _socket?: TLSSocket;
};

/** WSS client for the daemon endpoint, pinned to the certificate fingerprint shown by the daemon. */
export class PinnedDaemonClient {
  private socket?: WebSocket;
  private connected = false;
  private manuallyClosed = false;
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private reconnecting = false;
  private credentials?: DaemonCredentials;
  private readonly rpc: BunDaemonRpcChannel;

  constructor(private readonly onEvent: (event: BridgeEvent) => void) {
    this.rpc = new BunDaemonRpcChannel({
      isOpen: () => this.connected && this.socket?.readyState === WebSocket.OPEN,
      send: (data, callback) => {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          callback(new Error("Hive 데몬 연결이 끊어졌습니다. 연결 설정을 확인하세요."));
          return;
        }
        socket.send(data, callback);
      },
    });
  }

  connect(credentials: DaemonCredentials): Promise<void> {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      return Promise.reject(new Error("A Hive daemon connection is already open"));
    }

    let normalized: DaemonCredentials;
    try {
      normalized = normalizeCredentials(credentials);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.credentials = normalized;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.manuallyClosed = false;
    return this.openConnection(normalized);
  }

  private openConnection(normalized: DaemonCredentials): Promise<void> {
    this.manuallyClosed = false;
    const socket = new WebSocket(normalized.endpoint, {
      rejectUnauthorized: false,
      handshakeTimeout: 15_000,
      maxPayload: MAX_DAEMON_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    this.socket = socket;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => fail(new Error("Hive 데몬에 연결하지 못했습니다. 주소와 네트워크를 확인하세요.")), 15_000);
      const settle = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const fail = (error: Error): void => {
        settle(error);
        if (socket.readyState < WebSocket.CLOSING) socket.close();
      };

      socket.on("open", () => {
        try {
          const certificate = (socket as TlsWebSocket)._socket?.getPeerCertificate(true);
          if (!certificate?.raw) throw new Error("Hive 데몬이 TLS 인증서를 보내지 않았습니다.");
          const actual = createHash("sha256").update(certificate.raw).digest();
          const expected = Buffer.from(normalized.fingerprint, "hex");
          if (!timingSafeEqual(actual, expected)) {
            throw new Error("입력한 인증서 지문이 데몬과 일치하지 않습니다.");
          }

          // Do not send the pairing token until the daemon certificate has matched the supplied pin.
          socket.send(JSON.stringify({ type: "authenticate", token: normalized.token }));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });

      socket.on("message", (raw: RawData) => {
        let packet: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(rawMessage(raw));
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
          packet = parsed as Record<string, unknown>;
        } catch {
          return;
        }

        if (packet.type === "authenticated") {
          this.connected = true;
          this.startPing(socket);
          settle();
        } else if (packet.type === "event") {
          const event = parseBridgeEvent(packet.event);
          if (event) this.onEvent(event);
        } else if (packet.type === "response") {
          this.rpc.receiveResponse(packet);
        } else if (packet.type === "error" && typeof packet.error === "string") {
          fail(new Error(packet.error));
        }
      });

      socket.on("error", (error) => {
        if (!settled) fail(new Error(error.message || "Hive 데몬 TLS 연결에 실패했습니다."));
      });

      socket.on("close", (code, rawReason) => {
        const wasConnected = this.connected;
        this.connected = false;
        if (this.socket === socket) this.socket = undefined;
        this.stopPing();
        const reason = closeReason(code, rawReason);
        this.rpc.rejectAll(reason);
        if (!settled) settle(new Error(reason));
        if (wasConnected && !this.manuallyClosed) {
          this.onEvent({ target: "", threadId: "", method: "hive/transport/disconnected", params: { message: reason } });
          this.scheduleReconnect();
        }
      });
    });
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
    this.stopPing();
    this.rpc.rejectAll("Hive 데몬 연결을 종료했습니다.");
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Client disconnected");
  }

  private startPing(socket: WebSocket): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, 25_000);
    this.pingTimer.unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || !this.credentials || this.reconnecting || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      const credentials = this.credentials;
      if (this.manuallyClosed || !credentials || this.reconnecting || this.connected) return;
      this.reconnecting = true;
      void this.openConnection(credentials).then(() => {
        this.reconnecting = false;
        this.reconnectAttempt = 0;
        this.onEvent({ target: "", threadId: "", method: "hive/transport/reconnected", params: {} });
      }).catch((error: unknown) => {
        this.reconnecting = false;
        if (this.manuallyClosed || this.credentials !== credentials) return;
        const message = error instanceof Error ? error.message : String(error);
        if (/페어링 토큰|인증서 지문.*일치하지 않습니다|fingerprint.*(mismatch|does not match)/i.test(message)) {
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

function normalizeCredentials(credentials: DaemonCredentials): DaemonCredentials & { fingerprint: string } {
  let url: URL;
  try {
    url = new URL(credentials.endpoint.trim());
  } catch {
    throw new Error("데몬 주소를 wss:// 형식으로 입력하세요.");
  }
  if (url.protocol !== "wss:") throw new Error("데몬 연결에는 암호화된 wss:// 주소가 필요합니다.");
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/rpc";
  if (url.pathname !== "/rpc" || url.search || url.hash || url.username || url.password || !url.hostname) {
    throw new Error("데몬 주소에는 /rpc 경로만 사용할 수 있습니다.");
  }
  const fingerprint = credentials.fingerprint.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("데몬이 출력한 SHA-256 인증서 지문 64자리를 입력하세요.");
  }
  const token = credentials.token.trim();
  if (!token) throw new Error("데몬 페어링 토큰을 입력하세요.");
  return { endpoint: url.toString(), token, fingerprint };
}

function rawMessage(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

function closeReason(code: number, reason: Buffer): string {
  if (code === 1008) return "페어링 토큰을 확인하세요.";
  return reason.toString("utf8") || "Hive 데몬 연결이 종료되었습니다.";
}
