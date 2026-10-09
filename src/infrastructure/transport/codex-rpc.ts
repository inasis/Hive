import { createInterface } from "node:readline";
import type { CodexRpcTransport } from "./codex-rpc-transport.js";
import { CodexRpcPendingRequests } from "./codex-rpc-pending-requests.js";
import { CodexRpcMessageRouter } from "./codex-rpc-message-router.js";

type JsonObject = Record<string, unknown>;

/**
 * JSON-RPC client over a local process or SSH stream.
 */
export class CodexRpcConnection {
  private readonly output: CodexRpcTransport["output"];
  private readonly endTransport: () => void;
  private readonly terminateTransport: () => void;
  private readonly transportLabel: string;
  private readonly pendingRequests = new CodexRpcPendingRequests();
  private readonly messageRouter: CodexRpcMessageRouter;
  private closed = false;
  private exited = false;
  private stderrText = "";
  private readonly exitPromise: Promise<void>;
  private resolveExit!: () => void;

  constructor(transport: CodexRpcTransport) {
    this.output = transport.output;
    this.endTransport = transport.end;
    this.terminateTransport = transport.terminate;
    this.transportLabel = transport.label;
    this.messageRouter = new CodexRpcMessageRouter(this.pendingRequests, this.terminateTransport);
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });

    const lines = createInterface({ input: transport.input });
    lines.on("line", (line) => this.messageRouter.receiveLine(line));

    transport.stderr?.on("data", (chunk: Buffer) => {
      this.stderrText = `${this.stderrText}${chunk.toString("utf8")}`.slice(-8_000);
    });

    transport.subscribeExit((message) => this.markExited(message));
  }

  onNotification(
    listener: (method: string, params: unknown, requestId?: number | string) => void,
  ): () => void {
    return this.messageRouter.onNotification(listener);
  }

  respond(requestId: number | string, result: unknown): void {
    this.writeMessage({ id: requestId, result });
  }

  respondError(requestId: number | string, code: number, message: string): void {
    this.writeMessage({ id: requestId, error: { code, message } });
  }

  request(method: string, params: JsonObject, timeoutMs = 45_000): Promise<unknown> {
    if (this.closed || this.exited || !this.output.writable) {
      return Promise.reject(new Error("Codex app-server connection is closed"));
    }

    return new Promise<unknown>((resolve, reject) => {
      const id = this.pendingRequests.register(method, timeoutMs, resolve, reject);

      const frame = `${JSON.stringify({ method, id, params })}\n`;
      this.output.write(frame, "utf8", (error) => {
        if (!error) return;
        this.pendingRequests.reject(id, error);
      });
    });
  }

  notify(method: string, params: JsonObject): void {
    if (this.closed || this.exited || !this.output.writable) return;
    this.writeMessage({ method, params });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (!this.exited) {
      try {
        await this.requestWhileClosing("shutdown", {}, 1_000);
      } catch {
        // Older Codex builds may not implement shutdown; ending stdin remains safe.
      }
      if (!this.exited && this.output.writable) {
        this.output.write(`${JSON.stringify({ method: "exit" })}\n`);
        this.endTransport();
      }
      await Promise.race([this.exitPromise, delay(1_500)]);
      if (!this.exited) this.terminateTransport();
    }

    this.pendingRequests.rejectAll(new Error("Codex app-server connection closed"));
  }

  private requestWhileClosing(method: string, params: JsonObject, timeoutMs: number): Promise<unknown> {
    this.closed = false;
    const result = this.request(method, params, timeoutMs);
    this.closed = true;
    return result;
  }

  private writeMessage(message: JsonObject): void {
    if (this.closed || this.exited || !this.output.writable) {
      throw new Error("Codex app-server connection is closed");
    }
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private markExited(message: string): void {
    if (this.exited) return;
    this.exited = true;
    this.resolveExit();
    const suffix = this.stderrText.trim() ? `\n${this.stderrText.trim()}` : "";
    this.pendingRequests.rejectAll(new Error(`${this.transportLabel} exited. ${message}${suffix}`));
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
