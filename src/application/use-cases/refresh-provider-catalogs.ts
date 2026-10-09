import { ASSISTANT_PROVIDERS, type AssistantProvider } from "../../domain/provider-catalog.js";
import type {
  ProviderCatalogRefreshItem,
  ProviderCatalogRefreshObserverPort,
  ProviderCatalogRefreshPort,
  ProviderConnectionCatalogGatewayPort,
} from "../ports/provider-catalog.js";

/** Best-effort refresh of every provider catalog for each currently connected target. */
export class RefreshProviderCatalogsUseCase implements ProviderCatalogRefreshPort {
  constructor(private readonly gateway: ProviderConnectionCatalogGatewayPort) {}

  async refresh(targets: string[]): Promise<ProviderCatalogRefreshItem[]> {
    const results = await Promise.all(targets.flatMap((target) =>
      ASSISTANT_PROVIDERS.map(async ({ id: provider }) => {
        try {
          return { target, provider, catalog: await this.gateway.connect(target, provider) };
        } catch {
          return null;
        }
      }),
    ));
    return results.filter((item): item is ProviderCatalogRefreshItem => item !== null);
  }

  async refreshOtherProviders(
    target: string,
    selectedProvider: AssistantProvider,
    observer: ProviderCatalogRefreshObserverPort,
  ): Promise<void> {
    const providers = ASSISTANT_PROVIDERS.filter(({ id }) => id !== selectedProvider);
    await Promise.all(providers.map(async ({ id: provider }) => {
      try {
        const catalog = await this.gateway.connect(target, provider);
        observer.catalogAvailable({ target, provider, catalog });
      } catch {
        // Other provider catalogs are optional; a single unavailable provider must not block the rest.
      }
    }));
  }
}
