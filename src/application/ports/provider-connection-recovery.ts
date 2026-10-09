import type { AssistantThreadDto } from "../dto/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderConnectionCatalog } from "./provider-catalog.js";

export type ProviderConnectionRecoverySelection = {
  target: string;
  thread: AssistantThreadDto;
  sideChatId: string;
};

export type ProviderConnectionRecoveryRequest = {
  target: string;
  provider: AssistantProvider;
  activeThread: ProviderConnectionRecoverySelection | null;
};

export type ProviderConnectionRecoveryResult = {
  catalog: ProviderConnectionCatalog;
  selection?: ProviderConnectionRecoverySelection;
};

/** Refresh a provider catalog after its desktop daemon transport has recovered. */
export interface ProviderConnectionRecoveryPort {
  restore(request: ProviderConnectionRecoveryRequest): Promise<ProviderConnectionRecoveryResult>;
}
