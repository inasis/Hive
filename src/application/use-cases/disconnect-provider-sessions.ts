import { ASSISTANT_PROVIDERS } from "../../domain/provider-catalog.js";
import type { ProviderDisconnectGatewayPort, ProviderSessionsDisconnectPort } from "../ports/provider-disconnect.js";

/** Best-effort disconnection of every provider session hosted at a target. */
export class DisconnectProviderSessionsUseCase implements ProviderSessionsDisconnectPort {
  constructor(private readonly gateway: ProviderDisconnectGatewayPort) {}

  async disconnectAll(target: string): Promise<void> {
    await Promise.allSettled(ASSISTANT_PROVIDERS.map(({ id: provider }) =>
      this.gateway.disconnect(target, provider),
    ));
  }
}
