import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type AssistantThreadDto = {
  id: string;
  hiveSessionId?: string;
  provider: AssistantProvider;
  title: string;
  cwd: string;
  preview: string;
  updatedAt: string | number | null;
};

export type AssistantGoalDto = {
  objective: string;
  status?: string;
};

export type AssistantSkillDto = {
  id: string;
  name: string;
  description: string;
  provider: string;
  scope: string;
  enabled: boolean;
};

export type AssistantCommandDto = {
  name: string;
  description: string;
  provider: string;
  takesArguments: boolean;
};

export type AssistantModeDto = {
  id: string;
  name: string;
  description: string;
};

export type ReasoningEffortDto = {
  reasoningEffort: string;
  description: string;
};

export type AssistantModelDto = {
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: ReasoningEffortDto[];
  isDefault: boolean;
  hidden: boolean;
};

export type AssistantPermissionPresetDto = {
  id: string;
  label: string;
  description: string;
};

export type AssistantProviderCapabilitiesDto = {
  models: boolean;
  requiresModelBeforePrompt: boolean;
  reasoningEffort: boolean;
  permissionProfileCreation: boolean;
  permissionProfileUpdates: boolean;
  turnSteering: boolean;
  approvals: boolean;
  createNamedSessions: boolean;
  renameSessions: boolean;
  forks: boolean;
  persistentSideChats: boolean;
  sessionModes: boolean;
  skills: boolean;
  slashCommands: boolean;
  images: boolean;
  fileAttachments: boolean;
  workspaceFileRequests: boolean;
  terminalRequests: boolean;
};

export type AssistantProviderInfoDto = {
  id: AssistantProvider;
  name: string;
  capabilities: AssistantProviderCapabilitiesDto;
};
