import type { A2ACommunicationPermissionsDto } from "./a2a-collaboration.js";

/** Prompt attachment shapes passed between the UI, Application, and provider integrations. */
export type PromptImageAttachmentDto = {
  name: string;
  mimeType: string;
  data: string;
};

export type PromptFileAttachmentDto = {
  name: string;
  mimeType: string;
  content: string;
};

export type AgentDefinitionDto = {
  id: string;
  name: string;
  role: string;
  personality: string;
  persona: string;
  instructions: string;
};

/** Caller-selected context sent with a prompt; runtime policy is composed by the daemon. */
export type AgentContextDto = {
  definition?: AgentDefinitionDto;
  communicationPermissions?: A2ACommunicationPermissionsDto;
};
