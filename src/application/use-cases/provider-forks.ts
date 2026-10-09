import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderForkPorts, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../ports/provider-forks.js";
import { requireProviderCapability } from "../policies/provider-capability.js";
import { validateThreadId } from "../validation/thread-id.js";
import type { SessionIdentityPort } from "../ports/session-identities.js";
import { bindHiveSessionIdentity } from "./session-identity-resolution.js";

/** Validate shared branch-session input and dispatch to the selected provider adapter. */
export class ProviderForkUseCases {
  constructor(
    private readonly providers: ProviderForkPorts,
    private readonly identities?: SessionIdentityPort,
  ) {}

  async forkSideThread(provider: AssistantProvider, target: string, threadId: string): Promise<ProviderSideConversationResult> {
    validateThreadId(threadId);
    requireProviderCapability(provider, "forks", "forking conversations");
    if (!this.identities) return this.providers[provider].forkSideThread(target, threadId);
    const plannedId = await this.identities.reserve();
    try {
      const forked = await this.providers[provider].forkSideThread(target, threadId, plannedId);
      const identity = await bindHiveSessionIdentity(this.identities, provider, target, forked.threadId, plannedId, forked.title);
      return { ...forked, hiveSessionId: identity.hiveSessionId, title: identity.sessionName };
    } catch (error) {
      this.identities.release(plannedId);
      throw error;
    }
  }

  async forkThread(provider: AssistantProvider, target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    validateThreadId(threadId);
    const name = input.name.trim().slice(0, 120);
    if (!name) throw new Error("Fork session name cannot be empty");
    requireProviderCapability(provider, "forks", "forking conversations");
    if (!this.identities) return this.providers[provider].forkThread(target, threadId, { ...input, name });
    const plannedId = await this.identities.reserve();
    try {
      const forked = await this.providers[provider].forkThread(target, threadId, { ...input, name, hiveSessionId: plannedId });
      const identity = await bindHiveSessionIdentity(this.identities, provider, target, forked.threadId, plannedId, forked.title);
      return { ...forked, hiveSessionId: identity.hiveSessionId, title: identity.sessionName };
    } catch (error) {
      this.identities.release(plannedId);
      throw error;
    }
  }
}
