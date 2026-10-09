import { ASSISTANT_PROVIDERS, type AssistantProviderInfo } from "../../domain/provider-catalog.js";
import type { AssistantProviderInfoDto } from "../dto/assistant.js";

/** Copy the domain catalog entry into the transport-safe Application DTO. */
export function toAssistantProviderInfoDto(provider: AssistantProviderInfo): AssistantProviderInfoDto {
  return {
    id: provider.id,
    name: provider.name,
    capabilities: { ...provider.capabilities },
  };
}

export function listAssistantProviderInfoDtos(): AssistantProviderInfoDto[] {
  return ASSISTANT_PROVIDERS.map(toAssistantProviderInfoDto);
}
