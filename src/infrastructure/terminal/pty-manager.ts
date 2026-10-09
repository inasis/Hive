import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { isAbsolute } from "node:path";
import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";
import { assertSshTarget } from "../transport/workspace-target.js";
import type { StartTerminalInput, TerminalEventPayload, TerminalEventSink, TerminalPort } from "../../application/ports/terminal.js";
import { shellQuote } from "./shell.js";

type TerminalSession = {
  target: string;
  sessionId: string;
  stopped: boolean;
  pty?: IPty;
};

/** Own local and SSH PTY lifetimes for daemon consumers. */
export class PtyTerminalAdapter implements TerminalPort {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly publish: TerminalEventSink) {}

  async start({ target, cwd, sessionId, cols, rows }: StartTerminalInput): Promise<void> {
    if (!cwd.trim() || !isAbsolute(cwd)) throw new Error("Select an absolute workspace path before opening the terminal");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) throw new Error("Invalid terminal session ID");
    if (this.sessions.has(sessionId)) throw new Error("This terminal session is already open");
    const terminal: TerminalSession = { target, sessionId, stopped: false };
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
    terminal.pty?.write(Buffer.from(data, "base64").toString("utf8"));
  }

  resize(target: string, sessionId: string, cols: number, rows: number): void {
    const terminal = this.require(target, sessionId);
    const width = clampTerminalDimension(cols, 120);
    const height = clampTerminalDimension(rows, 32);
    terminal.pty?.resize(width, height);
  }

  stop(target: string, sessionId: string): void {
    const terminal = this.sessions.get(sessionId);
    if (!terminal || terminal.target !== target) return;
    this.sessions.delete(sessionId);
    terminal.stopped = true;
    if (terminal.pty) terminal.pty.kill();
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
