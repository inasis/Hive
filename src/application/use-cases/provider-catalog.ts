import type { AssistantProviderInfoDto, AssistantThreadDto } from "../dto/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { listAssistantProviderInfoDtos } from "../mappers/assistant-catalog-mapper.js";
import type { ProviderCatalogPorts, ProviderConnectionCatalog } from "../ports/provider-catalog.js";
import type { SessionIdentityPort } from "../ports/session-identities.js";
import { resolveHiveSessionIdentity } from "./session-identity-resolution.js";

/** Shared connect and refresh actions used by daemon, desktop, Android, and CLI interfaces. */
export class ProviderCatalogUseCases {
  constructor(
    private readonly providers: ProviderCatalogPorts,
    private readonly identities?: SessionIdentityPort,
  ) {}

  listProviders(): AssistantProviderInfoDto[] {
    return listAssistantProviderInfoDtos();
  }

  async connect(provider: AssistantProvider, target: string): Promise<ProviderConnectionCatalog> {
    const catalog = await this.providers[provider].connect(target);
    return { ...catalog, threads: await this.identifyThreads(provider, target, catalog.threads) };
  }

  async refresh(provider: AssistantProvider, target: string): Promise<{ threads: AssistantThreadDto[] }> {
    const threads = await this.providers[provider].refresh(target);
    return { threads: await this.identifyThreads(provider, target, threads) };
  }

  private identifyThreads(provider: AssistantProvider, target: string, threads: AssistantThreadDto[]): Promise<AssistantThreadDto[]> {
    if (!this.identities) return Promise.resolve(threads);
    return Promise.all(threads.map(async (thread) => {
      const identity = await resolveHiveSessionIdentity(this.identities!, provider, target, thread.id, thread.title);
      return { ...thread, hiveSessionId: identity.hiveSessionId, title: identity.sessionName };
    }));
  }
}
