import { ApplicationMenu, BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { dispatchDaemonRequest, startConfiguredA2AHttpServer, stopA2AHttpServer, subscribeDaemonEvents } from "../../../../src/composition/daemon.js";
import type { DaemonApiMethod, DaemonApiRequestMap, DaemonApiResponseMap } from "../../../../src/interfaces/contracts/daemon-api.js";
import type { BridgeEvent, GtkSettings, HiveBridgeSchema } from "../shared/bridge.js";
import { PinnedDaemonClient, type DaemonCredentials } from "./daemon-client.js";
import { parseGtkSettings } from "./gtk-settings.js";

let mainWindow: BrowserWindow;
const daemonBridges = new Map<string, PinnedDaemonClient>();

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
    const decoded: unknown = JSON.parse(output);
    return parseGtkSettings(decoded) ?? DEFAULT_GTK_SETTINGS;
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
function providerRequest<Method extends DaemonApiMethod>(method: Method) {
  return async (params: DaemonApiRequestMap[Method]): Promise<DaemonApiResponseMap[Method]> => dispatchDaemonRequest(method, params);
}

const requestHandlers: NonNullable<BunRpcConfig["handlers"]["requests"]> = {
      listProviders: providerRequest("listProviders"),
      daemonConnect: async (credentials: DaemonCredentials & { connectionId?: string }) => {
        const id = credentials.connectionId ?? "default";
        daemonBridges.get(id)?.disconnect();
        const bridge = new PinnedDaemonClient((event) => publishBridgeEvent({ ...event, target: `daemon:${id}` }));
        daemonBridges.set(id, bridge);
        try {
          await bridge.connect(credentials);
          return { connected: true as const };
        } catch (error) {
          if (daemonBridges.get(id) === bridge) daemonBridges.delete(id);
          bridge.disconnect();
          throw error;
        }
      },
      daemonRequest: ({ method, params, connectionId }) => {
        const daemonBridge = daemonBridges.get(connectionId ?? "default");
        if (!daemonBridge) throw new Error("Hive 데몬에 연결되지 않았습니다.");
        return daemonBridge.request(method, params);
      },
      daemonDisconnect: async ({ connectionId }) => {
        const id = connectionId ?? "default";
        const bridge = daemonBridges.get(id);
        daemonBridges.delete(id);
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
      getHostPlatform: () => ({ platform: process.platform }),
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
      disconnect: providerRequest("disconnect"),
      answerApproval: providerRequest("answerApproval"),
      terminalStart: providerRequest("terminalStart"),
      terminalInput: providerRequest("terminalInput"),
      terminalResize: providerRequest("terminalResize"),
      terminalStop: providerRequest("terminalStop"),
      listWorkspaceFiles: providerRequest("listWorkspaceFiles"),
      readWorkspaceFile: providerRequest("readWorkspaceFile"),
};

const rpc = BrowserView.defineRPC<HiveBridgeSchema>({ handlers: { requests: requestHandlers, messages: {} } });
subscribeDaemonEvents((event) => rpc.send.event(event));
await startConfiguredA2AHttpServer();
process.once("SIGINT", () => { void stopA2AHttpServer(); });
process.once("SIGTERM", () => { void stopA2AHttpServer(); });

mainWindow = new BrowserWindow({
  title: "Hive",
  // The webview needs the native host platform before its first render so it
  // can build the right custom titlebar while the RPC bridge initializes.
  url: `views://mainview/index.html?hostPlatform=${encodeURIComponent(process.platform)}`,
  frame: { width: 1440, height: 940, x: 120, y: 80 },
  styleMask: { Resizable: true },
  titleBarStyle: "hidden",
  rpc,
});

function publishBridgeEvent(event: BridgeEvent): void {
  rpc.send.event(event);
}
