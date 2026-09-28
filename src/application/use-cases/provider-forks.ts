import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderForkPorts, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../ports/provider-forks.js";
import { requireProviderCapability } from "./provider-capability.js";
import { validateThreadId } from "./provider-sessions.js";

/** Validate shared branch-session input and dispatch to the selected provider adapter. */
export class ProviderForkUseCases {
  constructor(private readonly providers: ProviderForkPorts) {}

  forkSideThread(provider: AssistantProvider, target: string, threadId: string): Promise<ProviderSideConversationResult> {
    validateThreadId(threadId);
    requireProviderCapability(provider, "forks", "forking conversations");
    return this.providers[provider].forkSideThread(target, threadId);
  }

  forkThread(provider: AssistantProvider, target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    validateThreadId(threadId);
    const name = input.name.trim().slice(0, 120);
    if (!name) throw new Error("Fork session name cannot be empty");
    requireProviderCapability(provider, "forks", "forking conversations");
    return this.providers[provider].forkThread(target, threadId, { ...input, name });
  }
}
