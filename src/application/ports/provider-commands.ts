import type { AssistantCommandDto, AssistantGoalDto, AssistantThreadDto } from "../dto/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ProviderCommandCatalog = { commands: AssistantCommandDto[]; warnings: string[]; goal?: AssistantGoalDto | null };
export type ProviderCommandResult = { executed: true; message?: string; turnId?: string; thread?: AssistantThreadDto; goal?: AssistantGoalDto | null };

/** Provider command discovery for an opened conversation. */
export interface ProviderCommandsPort {
  listCommands(target: string, threadId: string, cwd?: string): Promise<ProviderCommandCatalog>;
  runCommand(target: string, threadId: string, command: string, argumentsText: string, hiveSessionId?: string): Promise<ProviderCommandResult>;
}

export type ProviderCommandsPorts = Record<AssistantProvider, ProviderCommandsPort>;
