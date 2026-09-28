import type { PromptImageAttachment } from "../../domain/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ProviderPromptInput = {
  text: string;
  skillId?: string;
  cwd?: string;
  images?: PromptImageAttachment[];
};

export type ProviderSteerInput = {
  text: string;
  skillId?: string;
  cwd?: string;
};

export type ProviderPromptResult = { accepted: true; turnId?: string };
export type ProviderSteerResult = { steered: true; turnId?: string };
export type ProviderInterruptResult = { interrupted: true };

/** Provider operations for sending, steering, and interrupting a conversation turn. */
export interface ProviderTurnsPort {
  sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult>;
  steerTurn(target: string, threadId: string, turnId: string, input: ProviderSteerInput): Promise<ProviderSteerResult>;
  interruptTurn(target: string, threadId: string, turnId: string): Promise<ProviderInterruptResult>;
}

export type ProviderTurnsPorts = Record<AssistantProvider, ProviderTurnsPort>;
