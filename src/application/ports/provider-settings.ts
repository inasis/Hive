import type { ReasoningEffortDto } from "../dto/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ProviderThreadSettingsInput = {
  model?: string;
  effort?: string;
  permissionProfile?: string;
  modeId?: string;
};

export type ProviderThreadSettingsResult = {
  updated: true;
  model?: string;
  effort?: string;
  permissionProfile?: string;
  currentModeId?: string;
  supportedReasoningEfforts?: ReasoningEffortDto[];
};

export interface ProviderSettingsPort {
  updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult>;
}

export type ProviderSettingsPorts = Record<AssistantProvider, ProviderSettingsPort>;
