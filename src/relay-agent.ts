import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import { secureRelayStream } from "./e2e-stream.js";
import { connectHiveRelay, parseHiveRelayTarget, type HiveRelayTarget, type RelayChannel } from "./tcp-relay.js";
import { listLocalWorkspaceFiles, readLocalWorkspaceFile } from "./workspace-files.js";

/** Keep Codex, terminal, and file services available through separate encrypted relay channels. */
export async function runHiveRelayAgent(targetValue: string): Promise<void> {
  const target = parseHiveRelayTarget(targetValue);
  if (!target) throw new Error("The daemon needs a hive+tcp:// or hive+tls:// relay target");

  const abort = new AbortController();
  const stop = (): void => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write("Hive host agent started for pair " + target.pairId + " (Codex, terminal, files)\n");
  try {
    await Promise.all([
      runCodexAgent(target, abort.signal),
      runRelayService(target, "terminal", abort.signal, serveTerminal),
      runRelayService(target, "files", abort.signal, serveWorkspaceFiles),
    ]);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.write("Hive host agent stopped\n");
  }
}

async function runCodexAgent(target: HiveRelayTarget, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    let activeSocket: Socket | TLSSocket | undefined;
    let activeStream: Duplex | undefined;
    let activeChild: ChildProcessWithoutNullStreams | undefined;
    const onAbort = (): void => {
      activeStream?.destroy();
      activeSocket?.destroy();
      if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) activeChild.kill("SIGTERM");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      activeSocket = await connectHiveRelay(target, "agent", signal, "codex");
      activeStream = await secureRelayStream(activeSocket, target, "agent", "codex");
      if (signal.aborted) break;
      process.stdout.write("Hive relay client connected; starting local Codex app-server\n");
      activeChild = spawnChild("codex", ["app-server"], { stdio: "pipe" });
      const child = activeChild;
      activeStream.pipe(child.stdin);
      child.stdout.pipe(activeStream);
      child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
      await Promise.race([waitForClose(activeStream), waitForClose(child)]);
      process.stdout.write("Hive Codex relay session ended\n");
    } catch (error) {
      if (!signal.aborted) process.stderr.write("Hive Codex relay failed: " + errorMessage(error) + "\n");
    } finally {
      signal.removeEventListener("abort", onAbort);
      activeStream?.destroy();
      activeSocket?.destroy();
      if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) activeChild.kill("SIGTERM");
    }
    await delayUnlessAborted(signal, 1_500);
  }
}

async function runRelayService(
  target: HiveRelayTarget,
  channel: Exclude<RelayChannel, "codex">,
  signal: AbortSignal,
  serve: (stream: Duplex) => Promise<void>,
): Promise<void> {
  while (!signal.aborted) {
    let activeSocket: Socket | TLSSocket | undefined;
    let activeStream: Duplex | undefined;
    const onAbort = (): void => {
      activeStream?.destroy();
      activeSocket?.destroy();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      activeSocket = await connectHiveRelay(target, "agent", signal, channel);
      activeStream = await secureRelayStream(activeSocket, target, "agent", channel);
      if (!signal.aborted) await serve(activeStream);
    } catch (error) {
      if (!signal.aborted) process.stderr.write(`Hive ${channel} relay failed: ${errorMessage(error)}\n`);
    } finally {
      signal.removeEventListener("abort", onAbort);
      activeStream?.destroy();
      activeSocket?.destroy();
    }
    await delayUnlessAborted(signal, 1_000);
  }
}

async function serveTerminal(stream: Duplex): Promise<void> {
  let terminal: IPty | undefined;
  let exited = false;
  const send = (message: Record<string, unknown>): void => {
    if (!stream.destroyed && stream.writable) stream.write(JSON.stringify(message) + "\n");
  };
  try {
    for await (const message of readJsonLines(stream)) {
      if (message.type === "start") {
        if (terminal) {
          send({ type: "error", message: "A terminal is already running on this connection" });
          continue;
        }
        const cwd = typeof message.cwd === "string" ? message.cwd : "";
        if (!isAbsolute(cwd)) {
          send({ type: "error", message: "Terminal workspace path must be absolute" });
          continue;
        }
        try {
          const workspace = await stat(cwd);
          if (!workspace.isDirectory()) throw new Error("Terminal workspace path is not a directory");
          const cols = boundedDimension(message.cols, 120);
          const rows = boundedDimension(message.rows, 32);
          const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/bash");
          terminal = spawnPty(shell, process.platform === "win32" ? [] : ["-l"], {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env: process.env as Record<string, string>,
          });
          terminal.onData((data) => send({ type: "data", data: Buffer.from(data, "utf8").toString("base64") }));
          terminal.onExit(({ exitCode, signal: exitSignal }) => {
            exited = true;
            send({ type: "exit", exitCode, signal: exitSignal ?? null });
          });
          send({ type: "ready", cwd });
        } catch (error) {
          send({ type: "error", message: errorMessage(error) });
        }
      } else if (message.type === "input" && terminal && typeof message.data === "string") {
        try {
          terminal.write(Buffer.from(message.data, "base64").toString("utf8"));
        } catch {
          send({ type: "error", message: "Invalid terminal input encoding" });
        }
      } else if (message.type === "resize" && terminal) {
        try {
          terminal.resize(boundedDimension(message.cols, 120), boundedDimension(message.rows, 32));
        } catch (error) {
          send({ type: "error", message: errorMessage(error) });
        }
      } else if (message.type === "close") {
        return;
      }
    }
  } finally {
    if (terminal && !exited) terminal.kill();
  }
}

async function serveWorkspaceFiles(stream: Duplex): Promise<void> {
  for await (const message of readJsonLines(stream, 32 * 1024)) {
    try {
      if (typeof message.cwd !== "string" || typeof message.path !== "string") throw new Error("Invalid workspace request");
      if (message.operation === "list") {
        await writeAndEnd(stream, JSON.stringify(await listLocalWorkspaceFiles(message.cwd, message.path)) + "\n");
      } else if (message.operation === "read") {
        await writeAndEnd(stream, JSON.stringify(await readLocalWorkspaceFile(message.cwd, message.path)) + "\n");
      } else {
        throw new Error("Unknown workspace operation");
      }
    } catch (error) {
      await writeAndEnd(stream, JSON.stringify({ error: errorMessage(error) }) + "\n");
    }
    return;
  }
}

function writeAndEnd(stream: Duplex, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.destroyed || !stream.writable) { resolve(); return; }
    stream.end(data, (error?: Error | null) => error ? reject(error) : resolve());
  });
}

async function* readJsonLines(stream: Duplex, maxLineBytes = 256 * 1024): AsyncGenerator<Record<string, unknown>> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > maxLineBytes && buffer.indexOf(0x0a) < 0) throw new Error("Relay control message exceeded the size limit");
    while (true) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (line.length > maxLineBytes) throw new Error("Relay control message exceeded the size limit");
      let value: unknown;
      try {
        value = JSON.parse(line.toString("utf8"));
      } catch {
        throw new Error("Invalid relay control message");
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid relay control message");
      yield value as Record<string, unknown>;
    }
  }
}

function boundedDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(2, Math.min(500, value)) : fallback;
}

function waitForClose(source: Duplex | ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    source.once("close", () => resolve());
    source.once("error", () => resolve());
  });
}

function delayUnlessAborted(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => finish();
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
