import type { AssistantProvider } from "./provider-catalog.js";
import type { A2ACommunicationSummaryItem } from "./a2a.js";

export type AssistantThread = {
  id: string;
  provider: AssistantProvider;
  title: string;
  cwd: string;
  preview: string;
  updatedAt: string | number | null;
};

export type PromptImageAttachment = {
  name: string;
  mimeType: string;
  data: string;
};

export type TranscriptEntry = {
  id: string;
  role: "user" | "assistant" | "tool" | "change" | "communication";
  text: string;
  communications?: A2ACommunicationSummaryItem[];
  turnId?: string;
  providerMessageId?: string;
  responseDurationMs?: number;
  responseCompleted?: boolean;
  toolType?: "commandExecution" | "mcpToolCall" | "webSearch";
  command?: string;
  output?: string;
  status?: string;
  images?: PromptImageAttachment[];
};

export type AssistantSkill = {
  id: string;
  name: string;
  description: string;
  provider: string;
  scope: string;
  enabled: boolean;
};

export type AssistantCommand = {
  name: string;
  description: string;
  provider: string;
  takesArguments: boolean;
};

export type AssistantMode = {
  id: string;
  name: string;
  description: string;
};

export type ReasoningEffort = {
  reasoningEffort: string;
  description: string;
};

export type AssistantModel = {
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: ReasoningEffort[];
  isDefault: boolean;
  hidden: boolean;
};

export type AssistantPermissionPreset = {
  id: string;
  label: string;
  description: string;
};
