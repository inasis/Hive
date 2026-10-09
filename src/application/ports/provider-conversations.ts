import type {
  AssistantModeDto,
  AssistantModelDto,
  AssistantSkillDto,
  AssistantThreadDto,
} from "../dto/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { TranscriptEntryDto } from "../dto/transcript-cache.js";

export type ProviderCreateThreadInput = {
  cwd: string;
  name?: string;
  /** Reuse a known workspace model when a short-lived internal session is created. */
  model?: string;
  /** Skip UI-only model and skill catalog hydration for internal one-task sessions. */
  minimal?: boolean;
  /** Keep the currently focused provider thread active while creating an internal session. */
  preserveActiveThread?: boolean;
  /** Keep a provider-supported internal session in memory instead of persisting it. */
  ephemeral?: boolean;
  /** Preassigned Hive UUID for the provider session being created. */
  hiveSessionId?: string;
  /** Hive session identity supplied to an isolated provider process for A2A calls. */
  a2aCallerAgentId?: string;
  permissionPresets?: string[];
};

export type ProviderOpenThreadOptions = {
  includeTranscript: boolean;
  /** Return compact metadata for internal work; avoid interactive resume/focus changes when the provider allows it. */
  minimal?: boolean;
};

export type ProviderOpenThreadResult = {
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

export type ProviderCreateThreadResult = Omit<ProviderOpenThreadResult, "target" | "threadId"> & {
  thread: AssistantThreadDto;
  threadId: string;
  /** Whether deleting this new thread requires reopening the caller's existing thread. */
  requiresFocusRestoreAfterDelete?: boolean;
};

/** Provider-owned session creation and hydration, independent of daemon wire types. */
export interface ProviderConversationPort {
  createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult>;
  openThread(target: string, threadId: string, options?: ProviderOpenThreadOptions): Promise<ProviderOpenThreadResult>;
}

export type ProviderConversationPorts = Record<AssistantProvider, ProviderConversationPort>;
