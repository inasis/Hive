import type {
  ProviderConnectionRecoveryPort,
  ProviderConnectionRecoveryRequest,
  ProviderConnectionRecoveryResult,
} from "../ports/provider-connection-recovery.js";
import type { ProviderConnectionCatalogGatewayPort } from "../ports/provider-catalog.js";

/** Reconnect a provider catalog and resolve the selected session against its refreshed thread list. */
export class RestoreProviderConnectionUseCase implements ProviderConnectionRecoveryPort {
  constructor(private readonly gateway: ProviderConnectionCatalogGatewayPort) {}

  async restore(request: ProviderConnectionRecoveryRequest): Promise<ProviderConnectionRecoveryResult> {
    const catalog = await this.gateway.connect(request.target, request.provider);
    const active = request.activeThread;
    if (!active || active.target !== request.target || active.thread.provider !== request.provider) {
      return { catalog };
    }

    const refreshedThread = catalog.threads.find((thread) =>
      thread.id === active.thread.id && thread.provider === request.provider,
    );
    return {
      catalog,
      selection: {
        ...active,
        thread: refreshedThread ?? active.thread,
      },
    };
  }
}
