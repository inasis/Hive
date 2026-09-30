import type {
  DaemonApiRequest,
  DaemonApiRequestMap,
  DaemonApiResponse,
  DaemonApiResponseMap,
  WorkspaceFileListing,
  WorkspaceFileText,
} from "../../../../src/interfaces/contracts/daemon-api.js";
import type { BridgeEvent } from "../../../../src/interfaces/contracts/daemon-events.js";

export type { AssistantProvider, AssistantProviderInfo } from "../../../../src/domain/provider-catalog.js";
export { LOCAL_WORKSPACE_TARGET } from "../../../../src/domain/workspace.js";
export type {
  AssistantCommand as RemoteCommand,
  AssistantMode as RemoteMode,
  AssistantModel as RemoteModel,
  AssistantPermissionPreset as RemotePermissionPreset,
  AssistantSkill as RemoteSkill,
  AssistantThread as RemoteThread,
  PromptImageAttachment,
  ReasoningEffort as RemoteReasoningEffort,
  TranscriptEntry,
} from "../../../../src/domain/assistant.js";

export type { BridgeEvent } from "../../../../src/interfaces/contracts/daemon-events.js";
export type { WorkspaceFileItem, WorkspaceFileListing, WorkspaceFileText } from "../../../../src/interfaces/contracts/daemon-api.js";
export type GtkTitleButtonRaster = {
  width: number;
  height: number;
  normal: string;
  hover: string;
  active: string;
  disabled: string;
};
export type GtkSettings = {
  gtk: { version: 3; theme: string; iconTheme: string; font: string; fontFamily: string; dark: boolean };
  window: { decorationLayout: { layout: string; left: string[]; right: string[] } };
  icons: { menu: string };
  titleButtons: {
    spacing: number;
    minimize: GtkTitleButtonRaster;
    maximize: GtkTitleButtonRaster;
    restore: GtkTitleButtonRaster;
    close: GtkTitleButtonRaster;
  };
  button: Record<"normal" | "hover" | "active" | "disabled", { foreground: string; background: string }>;
  headerbar: { background: string; foreground: string; height: number };
};

type Request<P, R> = { params: P; response: R };
type Side<R, M> = { requests: R; messages: M };

export type HiveBridgeSchema = {
  bun: Side<
    {
      daemonConnect: Request<
        { endpoint: string; token: string; fingerprint: string; connectionId?: string },
        { connected: true }
      >;
      daemonRequest: Request<DaemonApiRequest & { connectionId?: string }, DaemonApiResponse>;
      daemonDisconnect: Request<{ connectionId?: string }, { disconnected: true }>;
      listProviders: Request<DaemonApiRequestMap["listProviders"], DaemonApiResponseMap["listProviders"]>;
      chooseWorkspaceFolder: Request<{ startingFolder?: string }, { path: string | null }>;
      connect: Request<DaemonApiRequestMap["connect"], DaemonApiResponseMap["connect"]>;
      refresh: Request<DaemonApiRequestMap["refresh"], DaemonApiResponseMap["refresh"]>;
      createThread: Request<DaemonApiRequestMap["createThread"], DaemonApiResponseMap["createThread"]>;
      renameThread: Request<DaemonApiRequestMap["renameThread"], DaemonApiResponseMap["renameThread"]>;
      deleteThread: Request<DaemonApiRequestMap["deleteThread"], DaemonApiResponseMap["deleteThread"]>;
      openThread: Request<DaemonApiRequestMap["openThread"], DaemonApiResponseMap["openThread"]>;
      forkSideThread: Request<DaemonApiRequestMap["forkSideThread"], DaemonApiResponseMap["forkSideThread"]>;
      forkThread: Request<DaemonApiRequestMap["forkThread"], DaemonApiResponseMap["forkThread"]>;
      listSkills: Request<DaemonApiRequestMap["listSkills"], DaemonApiResponseMap["listSkills"]>;
      listCommands: Request<DaemonApiRequestMap["listCommands"], DaemonApiResponseMap["listCommands"]>;
      runCommand: Request<DaemonApiRequestMap["runCommand"], DaemonApiResponseMap["runCommand"]>;
      sendPrompt: Request<DaemonApiRequestMap["sendPrompt"], DaemonApiResponseMap["sendPrompt"]>;
      steerTurn: Request<DaemonApiRequestMap["steerTurn"], DaemonApiResponseMap["steerTurn"]>;
      interruptTurn: Request<DaemonApiRequestMap["interruptTurn"], DaemonApiResponseMap["interruptTurn"]>;
      windowAction: Request<
        { action: "state" | "minimize" | "toggleMaximize" | "close" },
        { maximized: boolean }
      >;
      getHostPlatform: Request<{}, { platform: string }>;
      getWindowFrame: Request<{}, { x: number; y: number; width: number; height: number; maximized: boolean }>;
      getGtkSettings: Request<{}, GtkSettings>;
      setWindowFrame: Request<{ x: number; y: number; width: number; height: number }, { resized: true }>;
      updateThreadSettings: Request<DaemonApiRequestMap["updateThreadSettings"], DaemonApiResponseMap["updateThreadSettings"]>;
      disconnect: Request<DaemonApiRequestMap["disconnect"], DaemonApiResponseMap["disconnect"]>;
      answerApproval: Request<DaemonApiRequestMap["answerApproval"], DaemonApiResponseMap["answerApproval"]>;
      terminalStart: Request<DaemonApiRequestMap["terminalStart"], DaemonApiResponseMap["terminalStart"]>;
      terminalInput: Request<DaemonApiRequestMap["terminalInput"], DaemonApiResponseMap["terminalInput"]>;
      terminalResize: Request<DaemonApiRequestMap["terminalResize"], DaemonApiResponseMap["terminalResize"]>;
      terminalStop: Request<DaemonApiRequestMap["terminalStop"], DaemonApiResponseMap["terminalStop"]>;
      listWorkspaceFiles: Request<DaemonApiRequestMap["listWorkspaceFiles"], WorkspaceFileListing>;
      readWorkspaceFile: Request<DaemonApiRequestMap["readWorkspaceFile"], WorkspaceFileText>;
    },
    {}
  >;
  webview: Side<{}, { event: BridgeEvent }>;
};
