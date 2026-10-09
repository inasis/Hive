import type { IPty } from "@lydell/node-pty";
import type { AssistantCommand, AssistantMode, AssistantModel, AssistantSkill, TranscriptEntry } from "../../../domain/assistant.js";
import type { KiroAcpConnection } from "./acp-connection.js";

export type JsonObject = Record<string, unknown>;

export type KiroRemoteTerminal = {
  id: string;
  threadId: string;
  pty: IPty;
  output: Buffer;
  outputByteLimit: number;
  truncated: boolean;
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
  exitPromise: Promise<void>;
  resolveExit: () => void;
};

export type KiroRemoteSession = {
  connection: KiroAcpConnection;
  openedThreadIds: Set<string>;
  settingsByThread: Map<string, { model: string; effort: string | null }>;
  cwdByThread: Map<string, string>;
  models: AssistantModel[];
  commandsByThread: Map<string, AssistantCommand[]>;
  skillsByThread: Map<string, AssistantSkill[]>;
  modesByThread: Map<string, AssistantMode[]>;
  currentModeByThread: Map<string, string>;
  policyPresetsByThread: Map<string, string[]>;
  transcriptsByThread: Map<string, TranscriptEntry[]>;
  activeTurnIds: Map<string, string>;
  toolFailuresByThread: Map<string, { turnId: string; message: string }>;
  pendingApprovals: Map<string, { threadId: string; options: JsonObject[] }>;
  terminalsById: Map<string, KiroRemoteTerminal>;
  updateUnsubscribers: Map<string, () => void>;
};
