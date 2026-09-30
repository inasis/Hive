import type { AssistantThread } from "../../domain/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderCatalogPorts, ProviderConnectionCatalog } from "../ports/provider-catalog.js";

/** Shared connect and refresh actions used by daemon, desktop, Android, and CLI interfaces. */
export class ProviderCatalogUseCases {
  constructor(private readonly providers: ProviderCatalogPorts) {}

  connect(provider: AssistantProvider, target: string): Promise<ProviderConnectionCatalog> {
    return this.providers[provider].connect(target);
  }

  async refresh(provider: AssistantProvider, target: string): Promise<{ threads: AssistantThread[] }> {
    return { threads: await this.providers[provider].refresh(target) };
  }
}
