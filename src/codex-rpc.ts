import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { secureRelayStream } from "./e2e-stream.js";
import { connectHiveRelay, parseHiveRelayTarget, type HiveRelayTarget } from "./tcp-relay.js";

type JsonObject = Record<string, unknown>;

export const LOCAL_CODEX_TARGET = "hive-local://";

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

type RpcTransport = {
  input: Readable;
  output: Writable;
  label: string;
  stderr?: Readable;
  end: () => void;
  terminate: () => void;
  subscribeExit: (listener: (message: string) => void) => void;
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
  private readonly output: Writable;
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

  private constructor(transport: RpcTransport) {
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
    const relayTarget = parseHiveRelayTarget(target);
    const transport = target === LOCAL_CODEX_TARGET
      ? localTransport()
      : relayTarget
        ? await relayTransport(relayTarget)
        : sshTransport(target);
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

  request<T = unknown>(method: string, params: JsonObject, timeoutMs = 45_000): Promise<T> {
    if (this.closed || this.exited || !this.output.writable) {
      return Promise.reject(new Error("Codex app-server connection is closed"));
    }

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
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

  private requestWhileClosing<T>(method: string, params: JsonObject, timeoutMs: number): Promise<T> {
    this.closed = false;
    const result = this.request<T>(method, params, timeoutMs);
    this.closed = true;
    return result;
  }

  private receiveLine(line: string): void {
    if (!line.trim()) return;

    let message: RpcEnvelope;
    try {
      message = JSON.parse(line) as RpcEnvelope;
    } catch {
      this.failAll(
        new Error(`Remote app-server wrote a non-JSON line to stdout: ${line.slice(0, 300)}`),
      );
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

function localTransport(): RpcTransport {
  const command = process.platform === "win32" ? "codex.cmd" : "codex";
  const child: ChildProcessWithoutNullStreams = spawn(command, ["app-server"], {
    stdio: "pipe",
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
  return {
    input: child.stdout,
    output: child.stdin,
    stderr: child.stderr,
    label: "Local Codex app-server",
    end: () => child.stdin.end(),
    terminate: () => child.kill("SIGTERM"),
    subscribeExit: (listener) => {
      child.on("error", (error) => listener(error.message));
      child.on("exit", (code, signal) => listener(String(signal ?? code ?? "unknown status")));
    },
  };
}

function sshTransport(target: string): RpcTransport {
  assertSshTarget(target);
  const child: ChildProcessWithoutNullStreams = spawn(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "--",
      target,
      "bash -lc 'PATH=\"$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH\"; for codex_bin in \"$HOME\"/.nvm/versions/node/*/bin/codex; do [ -x \"$codex_bin\" ] && PATH=\"$(dirname \"$codex_bin\"):$PATH\"; done; export PATH; exec codex app-server'",
    ],
    { stdio: "pipe" },
  );
  return {
    input: child.stdout,
    output: child.stdin,
    stderr: child.stderr,
    label: "Remote Codex app-server",
    end: () => child.stdin.end(),
    terminate: () => child.kill("SIGTERM"),
    subscribeExit: (listener) => {
      child.on("error", (error) => listener(error.message));
      child.on("exit", (code, signal) => listener(String(signal ?? code ?? "unknown status")));
    },
  };
}

async function relayTransport(target: HiveRelayTarget): Promise<RpcTransport> {
  const socket = await connectHiveRelay(target, "client");
  const stream = await secureRelayStream(socket, target, "client");
  return {
    input: stream,
    output: stream,
    label: "Hive relay connection",
    end: () => stream.end(),
    terminate: () => stream.destroy(),
    subscribeExit: (listener) => {
      stream.once("error", (error) => listener(error.message));
      stream.once("close", () => listener("encrypted relay stream closed"));
    },
  };
}

export function assertSshTarget(target: string): void {
  // Keep this to SSH config aliases, DNS names, IPv4 literals, and user@host.
  // The remote command itself is fixed; arbitrary shell text is never accepted.
  if (!target || target.startsWith("-") || !/^[A-Za-z0-9_.@:-]+$/.test(target)) {
    throw new Error("SSH target must be a host alias or user@host, without shell arguments");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
