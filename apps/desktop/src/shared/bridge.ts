import type { AssistantProvider, AssistantProviderInfo } from "../../../../src/domain/provider-catalog.js";
import type {
  AssistantCommand as RemoteCommand,
  AssistantMode as RemoteMode,
  AssistantModel as RemoteModel,
  AssistantSkill as RemoteSkill,
  AssistantThread as RemoteThread,
  PromptImageAttachment,
  ReasoningEffort as RemoteReasoningEffort,
  TranscriptEntry,
} from "../../../../src/domain/assistant.js";
import type { DaemonApiMethod } from "../../../../src/daemon-api-contract.js";

export type { AssistantProvider, AssistantProviderInfo } from "../../../../src/domain/provider-catalog.js";
export type {
  AssistantCommand as RemoteCommand,
  AssistantMode as RemoteMode,
  AssistantModel as RemoteModel,
  AssistantSkill as RemoteSkill,
  AssistantThread as RemoteThread,
  PromptImageAttachment,
  ReasoningEffort as RemoteReasoningEffort,
  TranscriptEntry,
} from "../../../../src/domain/assistant.js";

export type WorkspaceFileItem = {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number | null;
};
export type WorkspaceFileListing = { path: string; items: WorkspaceFileItem[] };
export type WorkspaceFileText = { path: string; content: string; bytes: number };
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

export type BridgeEvent = {
  target: string;
  threadId: string;
  method: string;
  params: unknown;
  provider?: AssistantProvider;
  requestId?: number | string;
};

type Request<P, R> = { params: P; response: R };
type Side<R, M> = { requests: R; messages: M };

export type HiveBridgeSchema = {
  bun: Side<
    {
      daemonConnect: Request<
        { endpoint: string; token: string; fingerprint: string },
        { connected: true }
      >;
      daemonRequest: Request<{ method: DaemonApiMethod; params: unknown }, unknown>;
      daemonDisconnect: Request<{}, { disconnected: true }>;
      listProviders: Request<{}, { providers: AssistantProviderInfo[] }>;
      chooseWorkspaceFolder: Request<{ startingFolder?: string }, { path: string | null }>;
      connect: Request<
        { target: string; provider?: AssistantProvider },
        { target: string; threads: RemoteThread[]; models: RemoteModel[]; modelWarning?: string }
      >;
      refresh: Request<{ target: string; provider?: AssistantProvider }, { threads: RemoteThread[] }>;
      createThread: Request<
        { target: string; cwd: string; name?: string; permissionPresets?: string[]; provider?: AssistantProvider },
        {
          thread: RemoteThread;
          threadId: string;
          title: string;
          cwd: string;
          entries: TranscriptEntry[];
          skills: RemoteSkill[];
          skillWarnings: string[];
          modes?: RemoteMode[];
          currentModeId?: string | null;
          models?: RemoteModel[];
          modelWarning?: string;
          model: string;
          reasoningEffort: string | null;
          permissionProfile: string | null;
        }
      >;
      renameThread: Request<{ target: string; threadId: string; name: string; provider?: AssistantProvider }, { renamed: true }>;
      deleteThread: Request<{ target: string; threadId: string; provider?: AssistantProvider }, { deleted: true }>;
      openThread: Request<
        { target: string; threadId: string; provider?: AssistantProvider },
        {
          target: string;
          threadId: string;
          title: string;
          cwd: string;
          entries: TranscriptEntry[];
          skills: RemoteSkill[];
          skillWarnings: string[];
          modes?: RemoteMode[];
          currentModeId?: string | null;
          models?: RemoteModel[];
          modelWarning?: string;
          model: string;
          reasoningEffort: string | null;
          permissionProfile: string | null;
        }
      >;
      forkSideThread: Request<
        { target: string; threadId: string; provider?: AssistantProvider },
        {
          target: string;
          threadId: string;
          title: string;
          cwd: string;
          skills: RemoteSkill[];
          skillWarnings: string[];
          modes?: RemoteMode[];
          currentModeId?: string | null;
          models?: RemoteModel[];
          modelWarning?: string;
          model: string;
          reasoningEffort: string | null;
          permissionProfile: string | null;
        }
      >;
      forkThread: Request<
        { target: string; threadId: string; provider?: AssistantProvider; turnId?: string; messageId?: string; name: string },
        { target: string; threadId: string; title: string; cwd: string; preview: string; updatedAt: number; provider: AssistantProvider }
      >;
      listSkills: Request<{ target: string; threadId: string; cwd?: string; provider?: AssistantProvider }, { skills: RemoteSkill[]; warnings: string[] }>;
      listCommands: Request<{ target: string; threadId: string; cwd?: string; provider?: AssistantProvider }, { commands: RemoteCommand[]; warnings: string[] }>;
      runCommand: Request<{ target: string; threadId: string; command: string; arguments?: string; cwd?: string; provider?: AssistantProvider }, { executed: true; message?: string; turnId?: string; thread?: RemoteThread }>;
      sendPrompt: Request<{ target: string; threadId: string; text: string; skillId?: string; cwd?: string; images?: PromptImageAttachment[]; provider?: AssistantProvider }, { accepted: true; turnId?: string }>;
      steerTurn: Request<{ target: string; threadId: string; turnId: string; text: string; skillId?: string; cwd?: string; provider?: AssistantProvider }, { steered: true; turnId?: string }>;
      interruptTurn: Request<{ target: string; threadId: string; turnId: string; provider?: AssistantProvider }, { interrupted: true }>;
      windowAction: Request<
        { action: "state" | "minimize" | "toggleMaximize" | "close" },
        { maximized: boolean }
      >;
      getWindowFrame: Request<{}, { x: number; y: number; width: number; height: number; maximized: boolean }>;
      getGtkSettings: Request<{}, GtkSettings>;
      setWindowFrame: Request<{ x: number; y: number; width: number; height: number }, { resized: true }>;
      updateThreadSettings: Request<
        { target: string; threadId: string; model?: string; effort?: string; permissionProfile?: string; modeId?: string; provider?: AssistantProvider },
        { updated: true; model?: string; effort?: string; permissionProfile?: string; currentModeId?: string; supportedReasoningEfforts?: RemoteReasoningEffort[] }
      >;
      disconnect: Request<{ target: string; provider?: AssistantProvider }, { disconnected: true }>;
      answerApproval: Request<
        { target: string; requestId: number | string; decision: "accept" | "acceptForSession" | "decline"; provider?: AssistantProvider },
        { answered: true }
      >;
      terminalStart: Request<
        { target: string; cwd: string; sessionId: string; cols: number; rows: number },
        { sessionId: string; started: true }
      >;
      terminalInput: Request<{ target: string; sessionId: string; data: string }, { written: true }>;
      terminalResize: Request<{ target: string; sessionId: string; cols: number; rows: number }, { resized: true }>;
      terminalStop: Request<{ target: string; sessionId: string }, { stopped: true }>;
      listWorkspaceFiles: Request<
        { target: string; cwd: string; path: string },
        WorkspaceFileListing
      >;
      readWorkspaceFile: Request<
        { target: string; cwd: string; path: string },
        WorkspaceFileText
      >;
    },
    {}
  >;
  webview: Side<{}, { event: BridgeEvent }>;
};
