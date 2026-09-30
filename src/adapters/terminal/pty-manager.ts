import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import type { Duplex } from "node:stream";
import { isAbsolute } from "node:path";
import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";
import { assertSshTarget } from "../transport/workspace-target.js";
import { secureRelayStream } from "../transport/e2e-stream.js";
import { connectHiveRelay } from "../transport/relay-client.js";
import { parseHiveRelayTarget } from "../transport/relay-target.js";
import type { StartTerminalInput, TerminalEventPayload, TerminalEventSink, TerminalPort } from "../../application/ports/terminal.js";
import { shellQuote } from "./shell.js";

type TerminalSession = {
  target: string;
  sessionId: string;
  abort: AbortController;
  stopped: boolean;
  pty?: IPty;
  stream?: Duplex;
  receiveBuffer: Buffer;
};

/** Own PTY and encrypted relay terminal lifetimes for daemon consumers. */
export class PtyTerminalAdapter implements TerminalPort {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly publish: TerminalEventSink) {}

  async start({ target, cwd, sessionId, cols, rows }: StartTerminalInput): Promise<void> {
    if (!cwd.trim() || !isAbsolute(cwd)) throw new Error("Select an absolute workspace path before opening the terminal");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) throw new Error("Invalid terminal session ID");
    if (this.sessions.has(sessionId)) throw new Error("This terminal session is already open");
    const terminal: TerminalSession = { target, sessionId, abort: new AbortController(), stopped: false, receiveBuffer: Buffer.alloc(0) };
    this.sessions.set(sessionId, terminal);
    const width = clampTerminalDimension(cols, 120);
    const height = clampTerminalDimension(rows, 32);
    try {
      if (target === LOCAL_WORKSPACE_TARGET) {
        const shell = process.platform === "win32" ? (process.env.COMSPEC || "cmd.exe") : (process.env.SHELL || "/bin/bash");
        const args = process.platform === "win32" ? [] : ["-l"];
        const ptySession = spawnPty(shell, args, {
          name: "xterm-256color",
          cols: width,
          rows: height,
          cwd,
          env: process.env as Record<string, string>,
        });
        terminal.pty = ptySession;
        ptySession.onData((data) => this.sendEvent(terminal, { type: "data", data: Buffer.from(data, "utf8").toString("base64") }));
        ptySession.onExit(({ exitCode, signal }) => this.sendEvent(terminal, { type: "exit", exitCode, signal: signal ?? null }));
        return;
      }

      const relay = parseHiveRelayTarget(target);
      if (relay) {
        const socket = await connectHiveRelay(relay, "client", terminal.abort.signal, "terminal");
        if (terminal.stopped) { socket.destroy(); throw new Error("Terminal opening was cancelled"); }
        const stream = await secureRelayStream(socket, relay, "client", "terminal");
        if (terminal.stopped) { stream.destroy(); throw new Error("Terminal opening was cancelled"); }
        terminal.stream = stream;
        stream.on("data", (chunk: Buffer) => this.receiveRelayData(terminal, chunk));
        stream.once("error", (error) => this.sendEvent(terminal, { type: "error", message: error.message }));
        stream.once("close", () => {
          if (!terminal.stopped) this.sendEvent(terminal, { type: "exit", exitCode: null, signal: null });
        });
        stream.write(JSON.stringify({ type: "start", cwd, cols: width, rows: height }) + "\n");
        return;
      }

      assertSshTarget(target);
      const ptySession = spawnPty("ssh", ["-tt", "-o", "ServerAliveInterval=30", target, remoteTerminalCommand(cwd)], {
        name: "xterm-256color",
        cols: width,
        rows: height,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
      terminal.pty = ptySession;
      ptySession.onData((data) => this.sendEvent(terminal, { type: "data", data: Buffer.from(data, "utf8").toString("base64") }));
      ptySession.onExit(({ exitCode, signal }) => this.sendEvent(terminal, { type: "exit", exitCode, signal: signal ?? null }));
    } catch (error) {
      this.stop(target, sessionId);
      throw error;
    }
  }

  input(target: string, sessionId: string, data: string): void {
    const terminal = this.require(target, sessionId);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      throw new Error("Invalid terminal input encoding");
    }
    if (terminal.pty) terminal.pty.write(Buffer.from(data, "base64").toString("utf8"));
    else terminal.stream?.write(JSON.stringify({ type: "input", data }) + "\n");
  }

  resize(target: string, sessionId: string, cols: number, rows: number): void {
    const terminal = this.require(target, sessionId);
    const width = clampTerminalDimension(cols, 120);
    const height = clampTerminalDimension(rows, 32);
    if (terminal.pty) terminal.pty.resize(width, height);
    else terminal.stream?.write(JSON.stringify({ type: "resize", cols: width, rows: height }) + "\n");
  }

  stop(target: string, sessionId: string): void {
    const terminal = this.sessions.get(sessionId);
    if (!terminal || terminal.target !== target) return;
    this.sessions.delete(sessionId);
    terminal.stopped = true;
    terminal.abort.abort();
    if (terminal.pty) terminal.pty.kill();
    if (terminal.stream && !terminal.stream.destroyed) {
      terminal.stream.end(JSON.stringify({ type: "close" }) + "\n");
      setTimeout(() => terminal.stream?.destroy(), 200).unref();
    }
  }

  stopTarget(target: string): void {
    for (const terminal of [...this.sessions.values()]) {
      if (terminal.target === target) this.stop(target, terminal.sessionId);
    }
  }

  private require(target: string, sessionId: string): TerminalSession {
    const terminal = this.sessions.get(sessionId);
    if (!terminal || terminal.target !== target || terminal.stopped) throw new Error("Terminal session is no longer active");
    return terminal;
  }

  private receiveRelayData(terminal: TerminalSession, chunk: Buffer): void {
    terminal.receiveBuffer = Buffer.concat([terminal.receiveBuffer, chunk]);
    if (terminal.receiveBuffer.length > 1024 * 1024 && terminal.receiveBuffer.indexOf(0x0a) < 0) {
      this.sendEvent(terminal, { type: "error", message: "Terminal relay message exceeded the size limit" });
      terminal.stream?.destroy();
      return;
    }
    while (true) {
      const newline = terminal.receiveBuffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = terminal.receiveBuffer.subarray(0, newline);
      terminal.receiveBuffer = terminal.receiveBuffer.subarray(newline + 1);
      try {
        const message = asObject(JSON.parse(line.toString("utf8")) as unknown);
        if (!message) throw new Error("Invalid relay message");
        if (message.type === "data" && typeof message.data === "string") {
          this.sendEvent(terminal, { type: "data", data: message.data });
        } else if (message.type === "ready") {
          this.sendEvent(terminal, { type: "ready", cwd: typeof message.cwd === "string" ? message.cwd : "" });
        } else if (message.type === "error" && typeof message.message === "string") {
          this.sendEvent(terminal, { type: "error", message: message.message });
        } else if (message.type === "exit") {
          this.sendEvent(terminal, {
            type: "exit",
            exitCode: typeof message.exitCode === "number" ? message.exitCode : null,
            signal: typeof message.signal === "number" ? message.signal : null,
          });
        }
      } catch (error) {
        this.sendEvent(terminal, { type: "error", message: errorMessage(error) });
      }
    }
  }

  private sendEvent(terminal: TerminalSession, event: TerminalEventPayload): void {
    if (terminal.stopped) return;
    this.publish({ target: terminal.target, sessionId: terminal.sessionId, ...event });
  }
}

function remoteTerminalCommand(cwd: string): string {
  const loginShell = `cd -- ${shellQuote(cwd)} && exec "\${SHELL:-/bin/bash}" -l`;
  return `bash -lc ${shellQuote(loginShell)}`;
}

function clampTerminalDimension(value: number, fallback: number): number {
  return Number.isInteger(value) ? Math.max(2, Math.min(500, value)) : fallback;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
