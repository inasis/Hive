import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { requireProviderCapability } from "./provider-capability.js";
import type {
  ProviderInterruptResult,
  ProviderPromptInput,
  ProviderPromptResult,
  ProviderSteerInput,
  ProviderSteerResult,
  ProviderTurnsPorts,
} from "../ports/provider-turns.js";
import { validateThreadId } from "./provider-sessions.js";

/** Shared input validation and provider dispatch for conversation turns. */
export class ProviderTurnUseCases<Provider extends AssistantProvider = AssistantProvider> {
  constructor(private readonly providers: Pick<ProviderTurnsPorts, Provider>) {}

  sendPrompt(provider: Provider, target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> {
    validateThreadId(threadId);
    if (input.images?.length) requireProviderCapability(provider, "images", "attaching images to prompts");
    return this.providers[provider].sendPrompt(target, threadId, input);
  }

  steerTurn(provider: Provider, target: string, threadId: string, turnId: string, input: ProviderSteerInput): Promise<ProviderSteerResult> {
    validateThreadId(threadId);
    validateTurnId(turnId);
    if (!input.text.trim()) throw new Error("Message cannot be empty");
    requireProviderCapability(provider, "turnSteering", "steering an active response");
    return this.providers[provider].steerTurn(target, threadId, turnId, input);
  }

  interruptTurn(provider: Provider, target: string, threadId: string, turnId: string): Promise<ProviderInterruptResult> {
    validateThreadId(threadId);
    validateTurnId(turnId);
    return this.providers[provider].interruptTurn(target, threadId, turnId);
  }
}

function validateTurnId(turnId: string): void {
  if (!turnId.trim() || turnId.length > 128) throw new Error("Invalid turn ID");
}
