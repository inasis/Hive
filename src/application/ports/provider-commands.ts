import type { AssistantCommand, AssistantThread } from "../../domain/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ProviderCommandCatalog = { commands: AssistantCommand[]; warnings: string[] };
export type ProviderCommandResult = { executed: true; message?: string; turnId?: string; thread?: AssistantThread };

/** Provider command discovery for an opened conversation. */
export interface ProviderCommandsPort {
  listCommands(target: string, threadId: string, cwd?: string): Promise<ProviderCommandCatalog>;
  runCommand(target: string, threadId: string, command: string, argumentsText: string): Promise<ProviderCommandResult>;
}

export type ProviderCommandsPorts = Record<AssistantProvider, ProviderCommandsPort>;
