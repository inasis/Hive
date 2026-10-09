import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderCommandCatalog, ProviderCommandResult, ProviderCommandsPorts } from "../ports/provider-commands.js";
import { requireProviderCapability } from "../policies/provider-capability.js";
import { validateThreadId } from "../validation/thread-id.js";
import type { SessionIdentityPort } from "../ports/session-identities.js";
import { bindHiveSessionIdentity } from "./session-identity-resolution.js";

/** Validate shared command discovery input and dispatch to the provider adapter. */
export class ProviderCommandUseCases {
  constructor(
    private readonly providers: ProviderCommandsPorts,
    private readonly identities?: SessionIdentityPort,
  ) {}

  listCommands(provider: AssistantProvider, target: string, threadId: string, cwd?: string): Promise<ProviderCommandCatalog> {
    validateThreadId(threadId);
    requireProviderCapability(provider, "slashCommands", "listing slash commands");
    return this.providers[provider].listCommands(target, threadId, cwd);
  }

  async runCommand(provider: AssistantProvider, target: string, threadId: string, command: string, argumentsText = ""): Promise<ProviderCommandResult> {
    validateThreadId(threadId);
    requireProviderCapability(provider, "slashCommands", "running slash commands");
    if (!this.identities) return this.providers[provider].runCommand(target, threadId, command, argumentsText);
    const plannedId = await this.identities.reserve();
    try {
      const result = await this.providers[provider].runCommand(target, threadId, command, argumentsText, plannedId);
      if (!result.thread) {
        this.identities.release(plannedId);
        return result;
      }
      const identity = await bindHiveSessionIdentity(this.identities, provider, target, result.thread.id, plannedId, result.thread.title);
      return { ...result, thread: { ...result.thread, hiveSessionId: identity.hiveSessionId, title: identity.sessionName } };
    } catch (error) {
      this.identities.release(plannedId);
      throw error;
    }
  }
}
