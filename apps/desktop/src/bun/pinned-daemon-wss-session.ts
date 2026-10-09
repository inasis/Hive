import { createHash, timingSafeEqual } from "node:crypto";
import type { TLSSocket } from "node:tls";
import WebSocket, { type RawData } from "ws";
import { parseDaemonServerMessage } from "../../../../src/application/dto/daemon/daemon-server-message.js";
import type { DaemonResponsePacket } from "../../../../src/application/dto/daemon/daemon-transport.js";
import type { BridgeEvent } from "../../../../src/presentation/shared/bridge.js";

const MAX_DAEMON_MESSAGE_BYTES = 16 * 1024 * 1024;

type PinnedDaemonCredentials = {
  endpoint: string;
  token: string;
  fingerprint: string;
};

type PinnedDaemonWssSessionCallbacks = {
  onAuthenticated(): void;
  onEvent(event: BridgeEvent): void;
  onResponse(packet: DaemonResponsePacket): void;
  onClose(reason: string, wasAuthenticated: boolean): void;
};

type TlsWebSocket = WebSocket & {
  _socket?: TLSSocket;
};

/** Own one pinned WSS connection attempt, including authentication and daemon message routing. */
export class PinnedDaemonWssSession {
  private socket?: WebSocket;
  private authenticated = false;
  private pingTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly credentials: PinnedDaemonCredentials,
    private readonly callbacks: PinnedDaemonWssSessionCallbacks,
  ) {}

  connect(): Promise<void> {
    const socket = new WebSocket(this.credentials.endpoint, {
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
          const expected = Buffer.from(this.credentials.fingerprint, "hex");
          if (!timingSafeEqual(actual, expected)) {
            throw new Error("입력한 인증서 지문이 데몬과 일치하지 않습니다.");
          }

          // Do not send the pairing token until the daemon certificate has matched the supplied pin.
          socket.send(JSON.stringify({ type: "authenticate", token: this.credentials.token }));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });

      socket.on("message", (raw: RawData) => {
        let message: ReturnType<typeof parseDaemonServerMessage>;
        try {
          message = parseDaemonServerMessage(rawMessage(raw));
        } catch {
          return;
        }
        if (!message) return;

        if (message.type === "authenticated") {
          this.authenticated = true;
          this.startPing(socket);
          this.callbacks.onAuthenticated();
          settle();
        } else if (message.type === "event") {
          this.callbacks.onEvent(message.event);
        } else if (message.type === "response") {
          this.callbacks.onResponse(message.packet);
        } else if (message.type === "error") {
          fail(new Error(message.message));
        }
      });

      socket.on("error", (error) => {
        if (!settled) fail(new Error(error.message || "Hive 데몬 TLS 연결에 실패했습니다."));
      });

      socket.on("close", (code, rawReason) => {
        const wasAuthenticated = this.authenticated;
        this.authenticated = false;
        if (this.socket === socket) this.socket = undefined;
        this.stopPing();
        const reason = closeReason(code, rawReason);
        this.callbacks.onClose(reason, wasAuthenticated);
        if (!settled) settle(new Error(reason));
      });
    });
  }

  isOpen(): boolean {
    return this.authenticated && this.socket?.readyState === WebSocket.OPEN;
  }

  send(data: string, callback: (error?: Error) => void): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      callback(new Error("Hive 데몬 연결이 끊어졌습니다. 연결 설정을 확인하세요."));
      return;
    }
    socket.send(data, callback);
  }

  close(): void {
    this.stopPing();
    const socket = this.socket;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Client disconnected");
  }

  isConnectingOrOpen(): boolean {
    return Boolean(this.socket && this.socket.readyState < WebSocket.CLOSING);
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
