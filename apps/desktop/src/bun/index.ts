import { ApplicationMenu, BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import type { Duplex } from "node:stream";
import { assertSshTarget } from "../../../../src/codex-rpc.js";
import { dispatchDaemonRequest, subscribeDaemonEvents } from "../../../../src/daemon-api-handlers.js";
import { secureRelayStream } from "../../../../src/e2e-stream.js";
import { connectHiveRelay, parseHiveRelayTarget } from "../../../../src/tcp-relay.js";
import { requestRelayWorkspaceFile, requestSshWorkspaceFile } from "../../../../src/workspace-files.js";
import type { BridgeEvent, GtkSettings, HiveBridgeSchema } from "../shared/bridge.js";
import { PinnedDaemonClient, type DaemonCredentials } from "./daemon-client.js";

type JsonObject = Record<string, unknown>;
type TerminalSession = {
  target: string;
  sessionId: string;
  abort: AbortController;
  stopped: boolean;
  pty?: IPty;
  stream?: Duplex;
  receiveBuffer: Buffer;
};

const terminals = new Map<string, TerminalSession>();
let mainWindow: BrowserWindow;
let daemonBridge: PinnedDaemonClient | undefined;

const DEFAULT_GTK_SETTINGS: GtkSettings = {
  gtk: { version: 3, theme: "", iconTheme: "", font: "", fontFamily: "", dark: false },
  window: { decorationLayout: { layout: "menu:minimize,maximize,close", left: ["menu"], right: ["minimize", "maximize", "close"] } },
  icons: { menu: "" },
  titleButtons: {
    spacing: 3,
    minimize: { width: 0, height: 0, normal: "", hover: "", active: "", disabled: "" },
    maximize: { width: 0, height: 0, normal: "", hover: "", active: "", disabled: "" },
    restore: { width: 0, height: 0, normal: "", hover: "", active: "", disabled: "" },
    close: { width: 0, height: 0, normal: "", hover: "", active: "", disabled: "" },
  },
  button: {
    normal: { foreground: "#202020", background: "transparent" },
    hover: { foreground: "#202020", background: "rgba(0,0,0,0.08)" },
    active: { foreground: "#202020", background: "rgba(0,0,0,0.15)" },
    disabled: { foreground: "#808080", background: "transparent" },
  },
  headerbar: { background: "#eeeeec", foreground: "#202020", height: 46 },
};

async function readGtkSettings(): Promise<GtkSettings> {
  const packagedPath = `${import.meta.dir}/bin/gtk-settings-helper`;
  const developmentPath = `${import.meta.dir}/../../.hutch/gtk-settings-helper`;
  const helperPath = await Bun.file(packagedPath).exists() ? packagedPath : developmentPath;
  if (!(await Bun.file(helperPath).exists())) return DEFAULT_GTK_SETTINGS;
  try {
    const helper = Bun.spawn([helperPath], { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(helper.stdout).text();
    if (await helper.exited !== 0) return DEFAULT_GTK_SETTINGS;
    const result = JSON.parse(output) as GtkSettings;
    if (!result?.window?.decorationLayout || !Array.isArray(result.window.decorationLayout.left) || !Array.isArray(result.window.decorationLayout.right) || !result.titleButtons || !Number.isFinite(result.titleButtons.spacing)) {
      return DEFAULT_GTK_SETTINGS;
    }
    return result;
  } catch {
    return DEFAULT_GTK_SETTINGS;
  }
}

ApplicationMenu.setApplicationMenu([
  { submenu: [{ label: "Quit Hive", role: "quit" }] },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
]);

type BunRpcConfig = Parameters<typeof BrowserView.defineRPC<HiveBridgeSchema>>[0];
function providerRequest(method: string) {
  return async (params: any): Promise<any> => dispatchDaemonRequest(method, params);
}

const requestHandlers: NonNullable<BunRpcConfig["handlers"]["requests"]> = {
      listProviders: providerRequest("listProviders"),
      daemonConnect: async (credentials: DaemonCredentials) => {
        daemonBridge?.disconnect();
        const bridge = new PinnedDaemonClient(publishBridgeEvent);
        daemonBridge = bridge;
        try {
          await bridge.connect(credentials);
          return { connected: true as const };
        } catch (error) {
          if (daemonBridge === bridge) daemonBridge = undefined;
          bridge.disconnect();
          throw error;
        }
      },
      daemonRequest: ({ method, params }) => {
        if (!daemonBridge) throw new Error("Hive 데몬에 연결되지 않았습니다.");
        return daemonBridge.request(method, params);
      },
      daemonDisconnect: async () => {
        const bridge = daemonBridge;
        daemonBridge = undefined;
        bridge?.disconnect();
        return { disconnected: true as const };
      },
      chooseWorkspaceFolder: async ({ startingFolder }) => {
        const paths = await Utils.openFileDialog({
          ...(startingFolder ? { startingFolder } : {}),
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return { path: paths[0] ?? null };
      },
      connect: providerRequest("connect"),
      refresh: providerRequest("refresh"),
      renameThread: providerRequest("renameThread"),
      deleteThread: providerRequest("deleteThread"),
      createThread: providerRequest("createThread"),
      openThread: providerRequest("openThread"),
      forkSideThread: providerRequest("forkSideThread"),
      forkThread: providerRequest("forkThread"),
      listSkills: providerRequest("listSkills"),
      listCommands: providerRequest("listCommands"),
      runCommand: providerRequest("runCommand"),
      sendPrompt: providerRequest("sendPrompt"),
      steerTurn: providerRequest("steerTurn"),
      interruptTurn: providerRequest("interruptTurn"),
      windowAction: async ({ action }) => {
        if (action === "minimize") mainWindow.minimize();
        else if (action === "toggleMaximize") {
          if (mainWindow.isMaximized()) mainWindow.unmaximize();
          else mainWindow.maximize();
        } else if (action === "close") {
          mainWindow.close();
          return { maximized: false };
        }
        return { maximized: mainWindow.isMaximized() };
      },
      getGtkSettings: () => readGtkSettings(),
      getWindowFrame: () => ({ ...mainWindow.getFrame(), maximized: mainWindow.isMaximized() }),
      setWindowFrame: ({ x, y, width, height }) => {
        if (![x, y, width, height].every(Number.isFinite)) throw new Error("Invalid window frame");
        if (!mainWindow.isMaximized()) {
          mainWindow.setFrame(
            Math.round(x),
            Math.round(y),
            Math.max(640, Math.min(10000, Math.round(width))),
            Math.max(420, Math.min(10000, Math.round(height))),
          );
        }
        return { resized: true as const };
      },
      updateThreadSettings: providerRequest("updateThreadSettings"),
      disconnect: async (params) => {
        for (const terminal of [...terminals.values()]) {
          if (terminal.target === params.target) stopTerminal(terminal.target, terminal.sessionId);
        }
        return providerRequest("disconnect")(params);
      },
      answerApproval: providerRequest("answerApproval"),
      terminalStart: async ({ target, cwd, sessionId, cols, rows }) => {
        await startTerminal(target, cwd, sessionId, cols, rows);
        return { sessionId, started: true as const };
      },
      terminalInput: async ({ target, sessionId, data }) => {
        const terminal = requireTerminal(target, sessionId);
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
          throw new Error("Invalid terminal input encoding");
        }
        if (terminal.pty) terminal.pty.write(Buffer.from(data, "base64").toString("utf8"));
        else terminal.stream?.write(JSON.stringify({ type: "input", data }) + "\n");
        return { written: true as const };
      },
      terminalResize: async ({ target, sessionId, cols, rows }) => {
        const terminal = requireTerminal(target, sessionId);
        const width = clampTerminalDimension(cols, 120);
        const height = clampTerminalDimension(rows, 32);
        if (terminal.pty) terminal.pty.resize(width, height);
        else terminal.stream?.write(JSON.stringify({ type: "resize", cols: width, rows: height }) + "\n");
        return { resized: true as const };
      },
      terminalStop: async ({ target, sessionId }) => {
        stopTerminal(target, sessionId);
        return { stopped: true as const };
      },
      listWorkspaceFiles: async ({ target, cwd, path }) => {
        const relay = parseHiveRelayTarget(target);
        const result = relay
          ? await requestRelayWorkspaceFile(relay, "list", cwd, path)
          : await requestSshWorkspaceFile(target, cwd, "list", path);
        if (!("items" in result)) throw new Error("Remote workspace returned an invalid directory listing");
        return result;
      },
      readWorkspaceFile: async ({ target, cwd, path }) => {
        const relay = parseHiveRelayTarget(target);
        const result = relay
          ? await requestRelayWorkspaceFile(relay, "read", cwd, path)
          : await requestSshWorkspaceFile(target, cwd, "read", path);
        if (!("content" in result)) throw new Error("Remote workspace returned an invalid file preview");
        return result;
      },
};

const rpc = BrowserView.defineRPC<HiveBridgeSchema>({ handlers: { requests: requestHandlers, messages: {} } });
subscribeDaemonEvents((event) => rpc.send.event(event));

mainWindow = new BrowserWindow({
  title: "Hive",
  url: "views://mainview/index.html",
  frame: { width: 1440, height: 940, x: 120, y: 80 },
  styleMask: { Resizable: true },
  titleBarStyle: "hidden",
  rpc,
});

async function startTerminal(target: string, cwd: string, sessionId: string, cols: number, rows: number): Promise<void> {
  if (!cwd.trim() || !isAbsolutePath(cwd)) throw new Error("Select an absolute workspace path before opening the terminal");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) throw new Error("Invalid terminal session ID");
  if (terminals.has(sessionId)) throw new Error("This terminal session is already open");
  const terminal: TerminalSession = { target, sessionId, abort: new AbortController(), stopped: false, receiveBuffer: Buffer.alloc(0) };
  terminals.set(sessionId, terminal);
  const width = clampTerminalDimension(cols, 120);
  const height = clampTerminalDimension(rows, 32);
  try {
    const relay = parseHiveRelayTarget(target);
    if (relay) {
      const socket = await connectHiveRelay(relay, "client", terminal.abort.signal, "terminal");
      if (terminal.stopped) { socket.destroy(); throw new Error("Terminal opening was cancelled"); }
      const stream = await secureRelayStream(socket, relay, "client", "terminal");
      if (terminal.stopped) { stream.destroy(); throw new Error("Terminal opening was cancelled"); }
      terminal.stream = stream;
      stream.on("data", (chunk: Buffer) => receiveTerminalData(terminal, chunk));
      stream.once("error", (error) => sendTerminalEvent(terminal, "terminal/error", { message: error.message }));
      stream.once("close", () => {
        if (!terminal.stopped) sendTerminalEvent(terminal, "terminal/exit", { exitCode: null, signal: null });
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
    ptySession.onData((data) => sendTerminalEvent(terminal, "terminal/data", { data: Buffer.from(data, "utf8").toString("base64") }));
    ptySession.onExit(({ exitCode, signal }) => sendTerminalEvent(terminal, "terminal/exit", { exitCode, signal: signal ?? null }));
  } catch (error) {
    stopTerminal(target, sessionId);
    throw error;
  }
}

function receiveTerminalData(terminal: TerminalSession, chunk: Buffer): void {
  terminal.receiveBuffer = Buffer.concat([terminal.receiveBuffer, chunk]);
  if (terminal.receiveBuffer.length > 1024 * 1024 && terminal.receiveBuffer.indexOf(0x0a) < 0) {
    sendTerminalEvent(terminal, "terminal/error", { message: "Terminal relay message exceeded the size limit" });
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
        sendTerminalEvent(terminal, "terminal/data", { data: message.data });
      } else if (message.type === "ready") {
        sendTerminalEvent(terminal, "terminal/ready", { cwd: message.cwd ?? "" });
      } else if (message.type === "error" && typeof message.message === "string") {
        sendTerminalEvent(terminal, "terminal/error", { message: message.message });
      } else if (message.type === "exit") {
        sendTerminalEvent(terminal, "terminal/exit", { exitCode: message.exitCode ?? null, signal: message.signal ?? null });
      }
    } catch (error) {
      sendTerminalEvent(terminal, "terminal/error", { message: errorMessage(error) });
    }
  }
}

function sendTerminalEvent(terminal: TerminalSession, method: string, params: Record<string, unknown>): void {
  if (terminal.stopped) return;
  publishBridgeEvent({ target: terminal.target, threadId: terminal.sessionId, method, params });
}

function publishBridgeEvent(event: BridgeEvent): void {
  rpc.send.event(event);
}

function requireTerminal(target: string, sessionId: string): TerminalSession {
  const terminal = terminals.get(sessionId);
  if (!terminal || terminal.target !== target || terminal.stopped) throw new Error("Terminal session is no longer active");
  return terminal;
}

function stopTerminal(target: string, sessionId: string): void {
  const terminal = terminals.get(sessionId);
  if (!terminal || terminal.target !== target) return;
  terminals.delete(sessionId);
  terminal.stopped = true;
  terminal.abort.abort();
  if (terminal.pty) terminal.pty.kill();
  if (terminal.stream && !terminal.stream.destroyed) {
    terminal.stream.end(JSON.stringify({ type: "close" }) + "\n");
    setTimeout(() => terminal.stream?.destroy(), 200).unref();
  }
}

function clampTerminalDimension(value: number, fallback: number): number {
  return Number.isInteger(value) ? Math.max(2, Math.min(500, value)) : fallback;
}

function remoteTerminalCommand(cwd: string): string {
  const loginShell = `cd -- ${shellQuote(cwd)} && exec "\${SHELL:-/bin/bash}" -l`;
  return `bash -lc ${shellQuote(loginShell)}`;
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
