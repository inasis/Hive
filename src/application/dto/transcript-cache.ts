import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { AssistantModeDto, AssistantSkillDto } from "./assistant.js";
import type { A2ACommunicationSummaryItemDto } from "./a2a-communication.js";
import type { PromptImageAttachmentDto } from "./prompt.js";

export type TranscriptPromptImageDto = PromptImageAttachmentDto;

export type TranscriptEntryDto = {
  id: string;
  role: "user" | "assistant" | "tool" | "change" | "communication";
  text: string;
  createdAt?: number;
  communications?: A2ACommunicationSummaryItemDto[];
  turnId?: string;
  providerMessageId?: string;
  responseDurationMs?: number;
  responseCompleted?: boolean;
  toolType?: "commandExecution" | "mcpToolCall" | "webSearch";
  command?: string;
  output?: string;
  status?: string;
  images?: TranscriptPromptImageDto[];
};

export type TranscriptResponseGroupDto = {
  id: string;
  entries: TranscriptEntryDto[];
};

export type TranscriptCacheViewDto = {
  target: string;
  threadId: string;
  provider: AssistantProvider;
  title: string;
  cwd: string;
  model: string;
  effort: string | null;
  permissionProfile: string | null;
  modes: AssistantModeDto[];
  currentModeId: string | null;
  entries: TranscriptEntryDto[];
  skills: AssistantSkillDto[];
  skillWarnings: string[];
};

export type CachedTranscriptPageDto = {
  groups: TranscriptResponseGroupDto[];
  firstIndex: number;
  totalGroups: number;
  hasOlder: boolean;
  sourceUpdatedAt: string | number | null;
  view: Omit<TranscriptCacheViewDto, "entries">;
};

export type CachedCommunicationSummaryDto = {
  summaryId: string;
  communications: A2ACommunicationSummaryItemDto[];
  responseTurnId?: string;
  createdAt: number;
  updatedAt: number;
};
