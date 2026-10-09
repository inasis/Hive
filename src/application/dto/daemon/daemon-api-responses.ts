import type {
  AssistantCommandDto,
  AssistantGoalDto,
  AssistantModeDto,
  AssistantModelDto,
  AssistantPermissionPresetDto,
  AssistantProviderInfoDto,
  AssistantSkillDto,
  AssistantThreadDto,
  ReasoningEffortDto,
} from "../assistant.js";
import type { TranscriptEntryDto } from "../transcript-cache.js";
import type { AssistantProvider } from "../../../domain/provider-catalog.js";
import type { WorkspaceFileListingDto, WorkspaceFileTextDto } from "../workspace.js";

/** Provider-neutral conversation shape serialized by the daemon interface. */
export type DaemonOpenThreadResponse = {
  target: string;
  threadId: string;
  hiveSessionId?: string;
  title: string;
  cwd: string;
  entries: TranscriptEntryDto[];
  skills: AssistantSkillDto[];
  skillWarnings: string[];
  modes?: AssistantModeDto[];
  currentModeId?: string | null;
  models?: AssistantModelDto[];
  modelWarning?: string;
  model: string;
  reasoningEffort: string | null;
  permissionProfile: string | null;
};

export type DaemonCreateThreadResponse = Omit<DaemonOpenThreadResponse, "target" | "threadId"> & {
  thread: AssistantThreadDto;
  threadId: string;
  /** Retained to preserve the existing optional daemon response field. */
  requiresFocusRestoreAfterDelete?: boolean;
};

export type DaemonForkSideThreadResponse = Omit<DaemonOpenThreadResponse, "entries">;

export type DaemonForkThreadResponse = {
  target: string;
  threadId: string;
  hiveSessionId?: string;
  title: string;
  cwd: string;
  preview: string;
  updatedAt: number;
  provider: AssistantProvider;
};

/** Exact response DTOs for every method crossing a daemon/bridge boundary. */
export type DaemonApiResponseMap = {
  listProviders: { providers: AssistantProviderInfoDto[] };
  connect: { hostname?: string; target: string; threads: AssistantThreadDto[]; models: AssistantModelDto[]; permissionPresets?: AssistantPermissionPresetDto[]; modelWarning?: string };
  refresh: { threads: AssistantThreadDto[] };
  createThread: DaemonCreateThreadResponse;
  renameThread: { renamed: true };
  deleteThread: { deleted: true };
  openThread: DaemonOpenThreadResponse;
  forkSideThread: DaemonForkSideThreadResponse;
  forkThread: DaemonForkThreadResponse;
  listSkills: { skills: AssistantSkillDto[]; warnings: string[] };
  listCommands: { commands: AssistantCommandDto[]; warnings: string[]; goal?: AssistantGoalDto | null };
  runCommand: { executed: true; message?: string; turnId?: string; thread?: AssistantThreadDto; goal?: AssistantGoalDto | null };
  sendPrompt: { accepted: true; turnId?: string };
  steerTurn: { steered: true; turnId?: string };
  interruptTurn: { interrupted: true };
  updateThreadSettings: {
    updated: true;
    model?: string;
    effort?: string;
    permissionProfile?: string;
    currentModeId?: string;
    supportedReasoningEfforts?: ReasoningEffortDto[];
  };
  disconnect: { disconnected: true };
  answerApproval: { answered: true };
  terminalStart: { sessionId: string; started: true };
  terminalInput: { written: true };
  terminalResize: { resized: true };
  terminalStop: { stopped: true };
  listWorkspaceFiles: WorkspaceFileListingDto;
  readWorkspaceFile: WorkspaceFileTextDto;
};
