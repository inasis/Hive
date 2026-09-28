import type { ReasoningEffort } from "../../domain/assistant.js";
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
  supportedReasoningEfforts?: ReasoningEffort[];
};

export interface ProviderSettingsPort {
  updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult>;
}

export type ProviderSettingsPorts = Record<AssistantProvider, ProviderSettingsPort>;
