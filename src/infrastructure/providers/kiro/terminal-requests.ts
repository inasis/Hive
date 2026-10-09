import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { shellQuote } from "../../terminal/shell.js";
import type { KiroServerRequest } from "./acp-rpc.js";
import type { KiroRemoteSession, KiroRemoteTerminal } from "./session-types.js";
import { parseKiroTerminalCommandOptions, parseKiroTerminalOutputByteLimit } from "./terminal-request-parser.js";
import { firstString, type JsonObject } from "./session-utils.js";

/** Implement ACP terminal requests and own their PTY resource lifecycle. */
export async function handleKiroTerminalRequest(
  session: KiroRemoteSession,
  target: string,
  threadId: string,
  workspace: string,
  request: KiroServerRequest,
): Promise<void> {
  const terminalId = firstString(request.params.terminalId);
  if (request.method === "terminal/create") {
    const terminal = await createKiroRemoteTerminal(session, target, threadId, workspace, request.params);
    session.connection.respond(request.id, { terminalId: terminal.id });
    return;
  }
  if (!terminalId) throw new Error(`${request.method} requires a terminal ID`);
  const terminal = session.terminalsById.get(terminalId);
  if (!terminal || terminal.threadId !== threadId) throw new Error("Kiro ACP terminal is no longer active");
  if (request.method === "terminal/output") {
    session.connection.respond(request.id, {
      output: terminal.output.toString("utf8"),
      truncated: terminal.truncated,
      ...(terminal.exited ? { exitStatus: { exitCode: terminal.exitCode, signal: terminal.signal } } : {}),
    });
  } else if (request.method === "terminal/wait_for_exit") {
    await terminal.exitPromise;
    session.connection.respond(request.id, { exitCode: terminal.exitCode, signal: terminal.signal });
  } else if (request.method === "terminal/kill") {
    if (!terminal.exited) terminal.pty.kill();
    session.connection.respond(request.id, {});
  } else if (request.method === "terminal/release") {
    if (!terminal.exited) terminal.pty.kill();
    session.terminalsById.delete(terminal.id);
    session.connection.respond(request.id, {});
  } else {
    session.connection.respondError(request.id, -32601, `Unsupported Kiro ACP request: ${request.method}`);
  }
}

async function createKiroRemoteTerminal(
  session: KiroRemoteSession,
  target: string,
  threadId: string,
  workspace: string,
  params: JsonObject,
): Promise<KiroRemoteTerminal> {
  if (session.terminalsById.size >= 8) throw new Error("Kiro ACP supports up to eight active terminals per connection");
  const { command, args, env, requestedCwd } = parseKiroTerminalCommandOptions(params, workspace);
  const terminalCwd = await resolveKiroTerminalCwd(target, workspace, requestedCwd);
  const outputByteLimit = parseKiroTerminalOutputByteLimit(params.outputByteLimit);
  if (Buffer.byteLength(JSON.stringify({ root: workspace, cwd: terminalCwd, command, args, env }), "utf8") > 64 * 1024) {
    throw new Error("Kiro ACP terminal command metadata exceeds 64 KiB");
  }
  const id = randomUUID();
  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolvePromise) => { resolveExit = resolvePromise; });
  let pty: IPty;
  if (target === LOCAL_WORKSPACE_TARGET) {
    pty = spawnPty(command, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd: terminalCwd,
      env: { ...process.env, ...env },
    });
  } else {
    const payload = Buffer.from(JSON.stringify({ root: workspace, cwd: terminalCwd, command, args, env }), "utf8").toString("base64");
    const remoteCommand = `python3 -c ${shellQuote(KIRO_REMOTE_TERMINAL_SCRIPT)} ${shellQuote(payload)}`;
    pty = spawnPty("ssh", ["-tt", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "--", target, remoteCommand], {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
  }
  const terminal: KiroRemoteTerminal = {
    id,
    threadId,
    pty,
    output: Buffer.alloc(0),
    outputByteLimit,
    truncated: false,
    exited: false,
    exitCode: null,
    signal: null,
    exitPromise,
    resolveExit,
  };
  pty.onData((data) => appendKiroTerminalOutput(terminal, data));
  pty.onExit(({ exitCode, signal }) => {
    terminal.exited = true;
    terminal.exitCode = Number.isInteger(exitCode) ? exitCode : null;
    terminal.signal = signal === undefined || signal === null ? null : String(signal);
    terminal.resolveExit();
  });
  session.terminalsById.set(id, terminal);
  return terminal;
}

async function resolveKiroTerminalCwd(target: string, workspace: string, requestedCwd: string): Promise<string> {
  if (!isAbsolute(requestedCwd)) throw new Error("Kiro ACP terminal working directory must be absolute");
  if (target === LOCAL_WORKSPACE_TARGET) {
    const root = await realpath(workspace);
    const cwd = await realpath(requestedCwd);
    if (!isWithinFilesystemPath(root, cwd)) throw new Error("Kiro ACP terminal working directory must stay inside the selected workspace");
    if (!(await stat(cwd)).isDirectory()) throw new Error("Kiro ACP terminal working directory must be a directory");
    return cwd;
  }
  const root = resolve(workspace);
  const cwd = resolve(requestedCwd);
  if (!isWithinFilesystemPath(root, cwd)) throw new Error("Kiro ACP terminal working directory must stay inside the selected workspace");
  return cwd;
}

function isWithinFilesystemPath(root: string, target: string): boolean {
  const remainder = relative(root, target);
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

function appendKiroTerminalOutput(terminal: KiroRemoteTerminal, text: string): void {
  if (terminal.outputByteLimit === 0) {
    terminal.truncated ||= text.length > 0;
    return;
  }
  const combined = Buffer.concat([terminal.output, Buffer.from(text, "utf8")]);
  if (combined.length <= terminal.outputByteLimit) {
    terminal.output = combined;
    return;
  }
  terminal.truncated = true;
  let start = combined.length - terminal.outputByteLimit;
  while (start < combined.length && (combined[start]! & 0xc0) === 0x80) start++;
  terminal.output = combined.subarray(start);
}

const KIRO_REMOTE_TERMINAL_SCRIPT = [
  "import os,sys,json,base64",
  "try:",
  " p=json.loads(base64.b64decode(sys.argv[1])); root=os.path.realpath(p['root']); cwd=os.path.realpath(p['cwd'])",
  " if os.path.commonpath([root,cwd]) != root: raise ValueError('Terminal working directory must stay inside the selected workspace')",
  " if not os.path.isdir(cwd): raise ValueError('Terminal working directory must be a directory')",
  " os.chdir(cwd); env=os.environ.copy(); env.update(p.get('env',{})); command=p['command']; os.execvpe(command,[command]+p.get('args',[]),env)",
  "except Exception as e:",
  " print(str(e),file=sys.stderr); sys.exit(127)",
].join("\n");
