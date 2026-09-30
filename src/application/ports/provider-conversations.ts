import type { AssistantMode, AssistantModel, AssistantSkill, AssistantThread, TranscriptEntry } from "../../domain/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

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
  title: string;
  cwd: string;
  entries: TranscriptEntry[];
  skills: AssistantSkill[];
  skillWarnings: string[];
  modes?: AssistantMode[];
  currentModeId?: string | null;
  models?: AssistantModel[];
  modelWarning?: string;
  model: string;
  reasoningEffort: string | null;
  permissionProfile: string | null;
};

export type ProviderCreateThreadResult = Omit<ProviderOpenThreadResult, "target" | "threadId"> & {
  thread: AssistantThread;
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
