import type { AssistantProvider } from "../../domain/provider-catalog.js";

export interface ProviderDisconnectGatewayPort {
  disconnect(target: string, provider: AssistantProvider): Promise<void>;
}

export interface ProviderSessionsDisconnectPort {
  disconnectAll(target: string): Promise<void>;
}
