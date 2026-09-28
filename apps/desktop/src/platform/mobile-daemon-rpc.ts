import type { DaemonApiRequest } from "../../../../src/interfaces/contracts/daemon-api.js";
import { createDaemonRequestPacket, type DaemonResponsePacket } from "../../../../src/interfaces/contracts/daemon-transport.js";

const REQUEST_TIMEOUT_MS = 60_000;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
};

/** Multiplex daemon RPC requests over a message sender and settle pending replies. */
export class MobileDaemonRpcChannel {
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();

  request(request: DaemonApiRequest, send: (data: string) => void | Promise<void>): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("Hive 데몬 응답이 60초 동안 없습니다. 연결 상태와 세션 목록을 확인한 뒤 다시 시도하세요."));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(id, { resolve, reject, timeout });
      try {
        void Promise.resolve(send(JSON.stringify(createDaemonRequestPacket(id, request)))).catch((error: unknown) => {
          this.rejectRequest(id, asError(error));
        });
      } catch (error) {
        this.rejectRequest(id, asError(error));
      }
    });
  }

  receivePacket(packet: DaemonResponsePacket): void {
    const id = Number(packet.id);
    const pending = Number.isSafeInteger(id) ? this.pendingRequests.get(id) : undefined;
    if (!pending) return;
    this.finishRequest(id);
    if (typeof packet.error === "string") pending.reject(new Error(packet.error));
    else pending.resolve(packet.result);
  }

  rejectAll(message: string): void {
    for (const [id, pending] of this.pendingRequests) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pendingRequests.delete(id);
    }
  }

  private rejectRequest(id: number, error: Error): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    this.finishRequest(id);
    pending.reject(error);
  }

  private finishRequest(id: number): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
