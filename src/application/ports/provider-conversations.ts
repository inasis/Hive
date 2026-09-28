import type { AssistantMode, AssistantModel, AssistantSkill, AssistantThread, TranscriptEntry } from "../../domain/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ProviderCreateThreadInput = {
  cwd: string;
  name?: string;
  permissionPresets?: string[];
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
};

/** Provider-owned session creation and hydration, independent of daemon wire types. */
export interface ProviderConversationPort {
  createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult>;
  openThread(target: string, threadId: string): Promise<ProviderOpenThreadResult>;
}

export type ProviderConversationPorts = Record<AssistantProvider, ProviderConversationPort>;
