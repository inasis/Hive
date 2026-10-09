import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { KiroAcpPendingRequests } from "./acp-pending-requests.js";
import { parseKiroAcpMessage, type KiroAcpMessage } from "./acp-message-parser.js";
import type { KiroNotification, KiroServerRequest, KiroSessionUpdate } from "./acp-message-parser.js";

export type { KiroNotification, KiroServerRequest, KiroSessionUpdate } from "./acp-message-parser.js";

const REQUEST_TIMEOUT_MS = 60_000;
const PROMPT_TIMEOUT_MS = 30 * 60_000;
type JsonObject = Record<string, unknown>;

/** Own ACP stream framing and child-process lifecycle; pending calls are handled separately. */
export class KiroAcpRpc {
  private readonly pending = new KiroAcpPendingRequests();
  private readonly updateListeners = new Map<string, Set<(update: KiroSessionUpdate) => void>>();
  private readonly requestListeners = new Set<(request: KiroServerRequest) => void>();
  private readonly notificationListeners = new Set<(notification: KiroNotification) => void>();
  private closed = false;
  private closedError: Error | undefined;
  private stderrText = "";

  constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly label: string) {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.receiveLine(line));
    child.stderr.on("data", (chunk) => {
      this.stderrText = `${this.stderrText}${chunk.toString("utf8")}`.slice(-8_000);
    });
    child.once("error", (error) => this.closeUnexpectedly(new Error(`${label} 실행 실패: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (!this.closed) {
        const details = this.stderrText.trim();
        this.closeUnexpectedly(new Error(`${label} 프로세스가 종료되었습니다 (${signal ?? code ?? "상태 없음"})${details ? `: ${details}` : ""}`));
      }
    });
  }

  get isOpen(): boolean {
    return !this.closed && this.child.exitCode === null && this.child.signalCode === null && this.child.stdin.writable;
  }

  onSessionUpdate(sessionId: string, listener: (update: KiroSessionUpdate) => void): () => void {
    const listeners = this.updateListeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.updateListeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.updateListeners.delete(sessionId);
    };
  }

  onServerRequest(listener: (request: KiroServerRequest) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onNotification(listener: (notification: KiroNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: number | string, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  request(method: string, params: JsonObject, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.closed || this.child.exitCode !== null || this.child.signalCode !== null || !this.child.stdin.writable) {
      return Promise.reject(this.closedError ?? new Error("Kiro ACP connection is closed"));
    }
    return this.pending.request(method, timeoutMs, (id) => {
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: JsonObject): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  write(packet: JsonObject): void {
    if (this.closed || !this.child.stdin.writable) {
      throw this.closedError ?? new Error("Kiro ACP connection is closed");
    }
    this.child.stdin.write(`${JSON.stringify(packet)}\n`);
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.closedError = new Error("Kiro ACP connection terminated");
    this.failAll(this.closedError);
    this.child.kill("SIGTERM");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closedError = new Error("Kiro ACP connection closed");
    this.failAll(this.closedError);
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    const graceful = await Promise.race([exited.then(() => true), delay(1_500).then(() => false)]);
    if (!graceful && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      await Promise.race([exited, delay(1_000)]);
    }
  }

  private closeUnexpectedly(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closedError = error;
    this.failAll(error);
  }

  private receiveLine(line: string): void {
    const message: KiroAcpMessage = parseKiroAcpMessage(line);
    if (message.type === "invalid") {
      this.failAll(new Error(message.message));
      return;
    }
    if (message.type === "request") {
      for (const listener of this.requestListeners) listener(message.request);
      return;
    }
    if (message.type === "response") {
      this.pending.receive(message.id, message.result, message.error ? new Error(message.error) : undefined);
      return;
    }
    if (message.type !== "notification") return;
    if (message.sessionUpdate) {
      for (const listener of this.updateListeners.get(message.sessionUpdate.sessionId) ?? []) listener(message.sessionUpdate);
    }
    for (const listener of this.notificationListeners) listener(message.notification);
  }

  private failAll(error: Error): void {
    this.pending.failAll(error);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
