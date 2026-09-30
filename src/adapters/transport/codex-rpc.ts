import { createInterface } from "node:readline";
import { connectCodexProcessTransport, type CodexRpcTransport } from "./codex-process-transport.js";

type JsonObject = Record<string, unknown>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type RpcEnvelope = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export class CodexRpcError extends Error {
  readonly code: number | undefined;
  readonly data: unknown;

  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = "CodexRpcError";
    this.code = code;
    this.data = data;
  }
}

/**
 * JSON-RPC client over a local process, SSH, or the Hive TCP relay stream.
 */
export class CodexRpcConnection {
  private readonly output: CodexRpcTransport["output"];
  private readonly endTransport: () => void;
  private readonly terminateTransport: () => void;
  private readonly transportLabel: string;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<
    (method: string, params: unknown, requestId?: number | string) => void
  >();
  private nextId = 1;
  private closed = false;
  private exited = false;
  private stderrText = "";
  private readonly exitPromise: Promise<void>;
  private resolveExit!: () => void;

  private constructor(transport: CodexRpcTransport) {
    this.output = transport.output;
    this.endTransport = transport.end;
    this.terminateTransport = transport.terminate;
    this.transportLabel = transport.label;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });

    const lines = createInterface({ input: transport.input });
    lines.on("line", (line) => this.receiveLine(line));

    transport.stderr?.on("data", (chunk: Buffer) => {
      this.stderrText = `${this.stderrText}${chunk.toString("utf8")}`.slice(-8_000);
    });

    transport.subscribeExit((message) => this.markExited(message));
  }

  static async connect(target: string): Promise<CodexRpcConnection> {
    const transport = await connectCodexProcessTransport(target);
    const connection = new CodexRpcConnection(transport);
    try {
      await connection.request("initialize", {
        clientInfo: {
          name: "hive-codex-bridge",
          title: "Hive Codex Session Bridge",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      });
      connection.notify("initialized", {});
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  onNotification(
    listener: (method: string, params: unknown, requestId?: number | string) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timer,
      });

      const frame = `${JSON.stringify({ method, id, params })}\n`;
      this.output.write(frame, "utf8", (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
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

    this.failAll(new Error("Codex app-server connection closed"));
  }

  private requestWhileClosing(method: string, params: JsonObject, timeoutMs: number): Promise<unknown> {
    this.closed = false;
    const result = this.request(method, params, timeoutMs);
    this.closed = true;
    return result;
  }

  private receiveLine(line: string): void {
    if (!line.trim()) return;

    let message: RpcEnvelope | undefined;
    try {
      message = parseRpcEnvelope(JSON.parse(line) as unknown);
    } catch {
      message = undefined;
    }
    if (!message) {
      this.failAll(new Error("Codex app-server returned an invalid JSON-RPC message"));
      this.terminateTransport();
      return;
    }

    if (message.method) {
      for (const listener of this.listeners) {
        listener(message.method, message.params, message.id);
      }
      return;
    }

    if (message.id === undefined) return;
    const id = typeof message.id === "number" ? message.id : Number(message.id);
    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (message.error) {
      pending.reject(
        new CodexRpcError(
          message.error.message ?? "Codex app-server returned an RPC error",
          message.error.code,
          message.error.data,
        ),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
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
    this.failAll(new Error(`${this.transportLabel} exited. ${message}${suffix}`));
  }
}

function parseRpcEnvelope(value: unknown): RpcEnvelope | undefined {
  const message = asObject(value);
  if (!message) return undefined;
  if (message.id !== undefined && !((typeof message.id === "number" && Number.isFinite(message.id)) || typeof message.id === "string")) return undefined;
  if (message.method !== undefined && typeof message.method !== "string") return undefined;
  if (message.method !== undefined && ("result" in message || "error" in message)) return undefined;
  if (message.error !== undefined) {
    if (message.method !== undefined || message.id === undefined || "result" in message) return undefined;
    const error = asObject(message.error);
    if (!error) return undefined;
    if (error.code !== undefined && (typeof error.code !== "number" || !Number.isFinite(error.code))) return undefined;
    if (error.message !== undefined && typeof error.message !== "string") return undefined;
    return {
      ...(message.id !== undefined ? { id: message.id } : {}),
      ...(message.method !== undefined ? { method: message.method } : {}),
      ...(message.params !== undefined ? { params: message.params } : {}),
      ...(message.result !== undefined ? { result: message.result } : {}),
      error: {
        ...(error.code !== undefined ? { code: error.code } : {}),
        ...(error.message !== undefined ? { message: error.message } : {}),
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
    };
  }
  if (message.method === undefined && (message.id === undefined || !("result" in message))) return undefined;
  return {
    ...(message.id !== undefined ? { id: message.id } : {}),
    ...(message.method !== undefined ? { method: message.method } : {}),
    ...(message.params !== undefined ? { params: message.params } : {}),
    ...(message.result !== undefined ? { result: message.result } : {}),
  };
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
