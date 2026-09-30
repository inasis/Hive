import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderSettingsPorts, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../ports/provider-settings.js";
import { requireProviderCapability } from "../policies/provider-capability.js";
import { validateThreadId } from "../validation/thread-id.js";

/** Validate shared thread settings input and dispatch to the provider adapter. */
export class ProviderSettingsUseCases {
  constructor(private readonly providers: ProviderSettingsPorts) {}

  updateThreadSettings(provider: AssistantProvider, target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    validateThreadId(threadId);
    if (input.model !== undefined) requireProviderCapability(provider, "models", "changing models");
    if (input.effort !== undefined) requireProviderCapability(provider, "reasoningEffort", "changing reasoning effort");
    if (input.permissionProfile !== undefined) requireProviderCapability(provider, "permissionProfileUpdates", "changing permission profiles");
    if (input.modeId !== undefined) requireProviderCapability(provider, "sessionModes", "changing session modes");
    return this.providers[provider].updateThreadSettings(target, threadId, input);
  }
}
