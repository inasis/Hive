import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

const REQUEST_TIMEOUT_MS = 60_000;
const PROMPT_TIMEOUT_MS = 30 * 60_000;
type JsonObject = Record<string, unknown>;

export type KiroSessionUpdate = { sessionId: string; update: JsonObject };
export type KiroServerRequest = { id: number | string; method: string; params: JsonObject };
export type KiroNotification = { method: string; params: JsonObject };

/** Own ACP JSON-RPC framing, pending requests, and the child process stream lifecycle. */
export class KiroAcpRpc {
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly updateListeners = new Map<string, Set<(update: KiroSessionUpdate) => void>>();
  private readonly requestListeners = new Set<(request: KiroServerRequest) => void>();
  private readonly notificationListeners = new Set<(notification: KiroNotification) => void>();
  private nextId = 1;
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
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Kiro ACP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(asError(error));
      }
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.failAll(new Error("Kiro ACP returned invalid JSON"));
      return;
    }
    const packet = asObject(parsed);
    if (!packet) {
      this.failAll(new Error("Kiro ACP returned a non-object JSON message"));
      return;
    }
    const id = typeof packet.id === "number" || typeof packet.id === "string" ? packet.id : undefined;
    if (id !== undefined && typeof packet.method === "string") {
      const request = { id, method: packet.method, params: asObject(packet.params) ?? {} };
      for (const listener of this.requestListeners) listener(request);
      return;
    }
    if (id !== undefined) {
      if (typeof id !== "number") return;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      const error = asObject(packet.error);
      if (error) pending.reject(new Error(stringValue(error.message) ?? "Kiro ACP request failed"));
      else pending.resolve(packet.result);
      return;
    }
    if (typeof packet.method !== "string") return;
    const params = asObject(packet.params) ?? {};
    if (packet.method === "session/update" || packet.method === "session/notification") {
      const sessionId = stringValue(params.sessionId);
      const update = asObject(params.update) ?? asObject(params.notification) ?? params;
      if (!sessionId) return;
      for (const listener of this.updateListeners.get(sessionId) ?? []) listener({ sessionId, update });
    }
    for (const listener of this.notificationListeners) listener({ method: packet.method, params });
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
