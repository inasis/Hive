import type { BridgeEvent } from "../../../../src/application/dto/daemon/daemon-events.js";
import type { DaemonApiMethod } from "../../../../src/application/dto/daemon/daemon-api.js";
import { parseDaemonServerMessage } from "../../../../src/application/dto/daemon/daemon-server-message.js";
import type { DaemonResponsePacket } from "../../../../src/application/dto/daemon/daemon-transport.js";
import type { DaemonWssCredentials } from "./daemon-wss-socket";
import { DaemonWssSocket } from "./daemon-wss-socket";

export type DaemonClientWssSessionCallbacks = {
  onAuthenticated(): void;
  shouldEnableKeepAlive(credentials: DaemonWssCredentials): boolean;
  onKeepAliveFailure(message: string): void;
  onResume(credentials: DaemonWssCredentials): void;
  onEvent(event: BridgeEvent): void;
  onResponse(packet: DaemonResponsePacket): void;
  pendingMethods(): DaemonApiMethod[];
  onUnexpectedDisconnect(reason: string, retry?: boolean): void;
};

/** Own WSS authentication and routing of validated daemon messages for one connection attempt. */
export class DaemonClientWssSession {
  constructor(
    private readonly android: boolean,
    private readonly socket: DaemonWssSocket,
    private readonly callbacks: DaemonClientWssSessionCallbacks,
  ) {}

  connect(credentials: DaemonWssCredentials): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error("Hive 데몬에 연결하지 못했습니다. 주소와 네트워크를 확인하세요.")), 15_000);
      const finish = (error?: Error): boolean => {
        if (settled) return false;
        settled = true;
        window.clearTimeout(timeout);
        if (error) {
          this.socket.close();
          this.socket.reset();
          reject(error);
        } else {
          this.callbacks.onAuthenticated();
          resolve();
        }
        return true;
      };

      void this.socket.connect(credentials, {
        open: () => {
          void Promise.resolve(this.socket.send(JSON.stringify({ type: "authenticate", token: credentials.token })))
            .catch((error: unknown) => finish(asError(error)));
        },
        message: (data) => this.receiveMessage(data, credentials, finish),
        resume: () => this.callbacks.onResume(credentials),
        error: (message) => {
          if (!settled) finish(new Error(message));
          else if (this.android) this.callbacks.onUnexpectedDisconnect(message || "Hive 데몬 연결 오류입니다.");
        },
        close: (code, closeReason) => {
          const reason = code === 1008 ? "페어링 토큰을 확인하세요." : closeReason || "Hive 데몬 연결이 종료되었습니다.";
          if (!settled) finish(new Error(reason));
          else this.callbacks.onUnexpectedDisconnect(reason, code !== 1008);
        },
      }).catch((error: unknown) => finish(asError(error)));
    });
  }

  private receiveMessage(
    data: string,
    credentials: DaemonWssCredentials,
    finish: (error?: Error) => boolean,
  ): void {
    const message = parseDaemonServerMessage(data);
    if (!message) return;
    if (message.type === "authenticated") {
      finish();
      if (this.android && this.callbacks.shouldEnableKeepAlive(credentials)) {
        void this.socket.setKeepAlive(true).catch((error: unknown) => {
          this.callbacks.onKeepAliveFailure(asError(error).message);
        });
      }
    } else if (message.type === "event") {
      this.callbacks.onEvent(message.event);
    } else if (message.type === "response") {
      this.callbacks.onResponse(message.packet);
    } else if (message.type === "error") {
      const reason = daemonProtocolErrorMessage(message.message, this.callbacks.pendingMethods());
      if (!finish(new Error(reason))) this.callbacks.onUnexpectedDisconnect(reason, false);
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function daemonProtocolErrorMessage(message: string, pendingMethods: DaemonApiMethod[]): string {
  if (!/unsupported (?:mobile )?daemon request/i.test(message)) return message;
  const methods = pendingMethods.length ? ` (요청: ${pendingMethods.join(", ")})` : "";
  return `Hive 데몬이 요청 형식을 지원하지 않습니다${methods}. Android 앱과 Hive 데몬 버전을 맞추고 데몬을 다시 시작하세요.`;
}
