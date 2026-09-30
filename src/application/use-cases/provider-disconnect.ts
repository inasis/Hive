import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderCatalogPorts } from "../ports/provider-catalog.js";
import type { TerminalPort } from "../ports/terminal.js";

/** Release workspace terminal resources before disconnecting a provider target. */
export class ProviderDisconnectUseCases {
  constructor(
    private readonly providers: ProviderCatalogPorts,
    private readonly terminal: Pick<TerminalPort, "stopTarget">,
  ) {}

  async disconnect(provider: AssistantProvider, target: string): Promise<void> {
    this.terminal.stopTarget(target);
    await this.providers[provider].disconnect(target);
  }
}
