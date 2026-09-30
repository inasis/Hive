import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderCommandCatalog, ProviderCommandResult, ProviderCommandsPorts } from "../ports/provider-commands.js";
import { requireProviderCapability } from "../policies/provider-capability.js";
import { validateThreadId } from "../validation/thread-id.js";

/** Validate shared command discovery input and dispatch to the provider adapter. */
export class ProviderCommandUseCases {
  constructor(private readonly providers: ProviderCommandsPorts) {}

  listCommands(provider: AssistantProvider, target: string, threadId: string, cwd?: string): Promise<ProviderCommandCatalog> {
    validateThreadId(threadId);
    requireProviderCapability(provider, "slashCommands", "listing slash commands");
    return this.providers[provider].listCommands(target, threadId, cwd);
  }

  runCommand(provider: AssistantProvider, target: string, threadId: string, command: string, argumentsText = ""): Promise<ProviderCommandResult> {
    validateThreadId(threadId);
    requireProviderCapability(provider, "slashCommands", "running slash commands");
    return this.providers[provider].runCommand(target, threadId, command, argumentsText);
  }
}
