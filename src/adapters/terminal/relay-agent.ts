import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import type { Duplex } from "node:stream";
import { isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import { readRelayAgentMessages, writeRelayAgentMessage } from "../transport/relay-agent-control.js";

/** Serve the relay terminal protocol while this adapter owns the host PTY lifecycle. */
export async function serveRelayAgentTerminal(stream: Duplex): Promise<void> {
  let terminal: IPty | undefined;
  let exited = false;
  const send = (message: Parameters<typeof writeRelayAgentMessage>[1]): void => writeRelayAgentMessage(stream, message);
  try {
    for await (const message of readRelayAgentMessages(stream)) {
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

function boundedDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(2, Math.min(500, value)) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
