import { parseDaemonApiRequest, type DaemonApiMethod } from "../../../../src/interfaces/contracts/daemon-api.js";
import { parseDaemonApiResponse } from "../../../../src/interfaces/contracts/daemon-response.js";

const REQUEST_TIMEOUT_MS = 120_000;

type PendingRequest = {
  method: DaemonApiMethod;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type DaemonRpcTransport = {
  isOpen(): boolean;
  send(data: string, callback: (error?: Error) => void): void;
};

/** Own daemon API validation, request correlation, response decoding, timeouts, and pending cleanup. */
export class BunDaemonRpcChannel {
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly transport: DaemonRpcTransport) {}

  request(method: string, params: unknown): Promise<unknown> {
    let request;
    try {
      request = parseDaemonApiRequest(method, params);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    if (!this.transport.isOpen()) {
      return Promise.reject(new Error("Hive 데몬 연결이 끊어졌습니다. 연결 설정을 확인하세요."));
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Hive 데몬 응답 시간이 초과되었습니다."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { method: request.method, resolve, reject, timeout });
      try {
        this.transport.send(JSON.stringify({ type: "request", id, ...request }), (error) => {
          if (error) this.rejectRequest(id, error);
        });
      } catch (error) {
        this.rejectRequest(id, asError(error));
      }
    });
  }

  receiveResponse(packet: Record<string, unknown>): boolean {
    if (packet.type !== "response" || (typeof packet.id !== "number" && typeof packet.id !== "string")) return false;
    const id = Number(packet.id);
    const pending = this.pending.get(id);
    if (!pending) return true;
    this.finishRequest(id);
    if (typeof packet.error === "string") pending.reject(new Error(packet.error));
    else {
      try {
        pending.resolve(parseDaemonApiResponse(pending.method, packet.result));
      } catch (error) {
        pending.reject(asError(error));
      }
    }
    return true;
  }

  rejectAll(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  private rejectRequest(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.finishRequest(id);
    pending.reject(error);
  }

  private finishRequest(id: number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
