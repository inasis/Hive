import { assistantProviderSupports, type AssistantProvider } from "../../domain/provider-catalog.js";
import { a2aCommunicationGroupKey } from "../../domain/a2a.js";
import { requireProviderCapability } from "../policies/provider-capability.js";
import type {
  ProviderInterruptResult,
  ProviderPromptInput,
  ProviderPromptResult,
  ProviderSteerInput,
  ProviderSteerResult,
  ProviderTurnsPorts,
} from "../ports/provider-turns.js";
import type { AssistantEventPublisher } from "../ports/events.js";
import { validateThreadId } from "../validation/thread-id.js";

/** Shared input validation and provider dispatch for conversation turns. */
export class ProviderTurnUseCases<Provider extends AssistantProvider = AssistantProvider> {
  constructor(
    private readonly providers: Pick<ProviderTurnsPorts, Provider>,
    private readonly publishEvent?: AssistantEventPublisher,
  ) {}

  async sendPrompt(provider: Provider, target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> {
    validateThreadId(threadId);
    if (input.images !== undefined) requireProviderCapability(provider, "images", "attaching images to prompts");
    if (assistantProviderSupports(provider, "requiresModelBeforePrompt")) {
      await this.providers[provider].assertPromptReady(target, threadId);
    }
    const result = await this.providers[provider].sendPrompt(target, threadId, input);
    const communications = input.a2aCommunications;
    if (communications?.length) {
      this.publishEvent?.({
        type: "a2aCommunicationSummary",
        target,
        threadId,
        provider,
        summaryId: a2aCommunicationGroupKey(communications),
        ...(result.turnId ? { responseTurnId: result.turnId } : {}),
        communications,
      });
    }
    return result;
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
