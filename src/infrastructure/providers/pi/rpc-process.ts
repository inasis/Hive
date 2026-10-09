import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { asObject } from "./session-json-values.js";

type JsonObject = Record<string, unknown>;

export type PiRpcProcessOptions = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onRecord?: (record: JsonObject) => void;
};

/** Small JSONL client for Pi's documented RPC process interface. */
export class PiRpcProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<string, {
    resolve: (record: JsonObject) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private closeError: Error | undefined;

  constructor(private readonly options: PiRpcProcessOptions) {}

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer | string) => this.read(chunk));
    // Pi reserves stdout for protocol data; drain diagnostics without logging them.
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => this.fail(new Error(`Could not start Pi CLI: ${error.message}`, { cause: error })));
    child.on("close", (code, signal) => {
      const reason = code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`;
      this.fail(new Error(`Pi RPC process exited with ${reason}`));
    });
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(new Error(`Could not start Pi CLI: ${error.message}`, { cause: error })); };
      const cleanup = () => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }

  async request(command: JsonObject, timeoutMs = 20_000): Promise<JsonObject> {
    const child = this.child;
    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      throw this.closeError ?? new Error("Pi RPC process is not running");
    }
    const id = randomUUID();
    const record = { ...command, id };
    const line = `${JSON.stringify(record)}\n`;
    return new Promise<JsonObject>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC command '${String(command.type ?? "unknown")}' timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(line, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(new Error(`Could not write to Pi RPC process: ${error.message}`, { cause: error }));
      });
    }).then((response) => {
      if (response.success !== true) {
        const message = typeof response.error === "string" ? response.error : "Pi RPC command failed";
        throw new Error(message);
      }
      return asObject(response.data) ?? {};
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.stdin.end();
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  terminate(): void {
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  private read(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this.buffer = Buffer.concat([this.buffer, bytes]);
    let delimiter: number;
    while ((delimiter = this.buffer.indexOf(0x0a)) >= 0) {
      let line = this.buffer.subarray(0, delimiter);
      this.buffer = this.buffer.subarray(delimiter + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, line.length - 1);
      if (line.length === 0) continue;
      if (line.length > 16 * 1024 * 1024) {
        this.fail(new Error("Pi RPC record exceeded the 16 MiB limit"));
        return;
      }
      let record: JsonObject | undefined;
      try {
        record = asObject(JSON.parse(line.toString("utf8")));
      } catch (error) {
        this.fail(new Error("Pi RPC emitted an invalid JSON record", { cause: error }));
        return;
      }
      if (!record) {
        this.fail(new Error("Pi RPC emitted a non-object JSON record"));
        return;
      }
      if (record.type === "response" && typeof record.id === "string") {
        const pending = this.pending.get(record.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(record.id);
          pending.resolve(record);
          continue;
        }
      }
      this.options.onRecord?.(record);
    }
    if (this.buffer.length > 16 * 1024 * 1024) this.fail(new Error("Pi RPC record exceeded the 16 MiB limit"));
  }

  private fail(error: Error): void {
    this.closeError ??= error;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
