import type { AssistantModel, AssistantPermissionPreset, AssistantThread } from "../../domain/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ProviderConnectionCatalog = {
  threads: AssistantThread[];
  models: AssistantModel[];
  permissionPresets?: AssistantPermissionPreset[];
  modelWarning?: string;
};

/** Provider operations needed to connect to a catalog and refresh its sessions. */
export interface ProviderCatalogPort {
  connect(target: string): Promise<ProviderConnectionCatalog>;
  refresh(target: string): Promise<AssistantThread[]>;
  disconnect(target: string): Promise<void>;
}

export type ProviderCatalogPorts = Record<AssistantProvider, ProviderCatalogPort>;
