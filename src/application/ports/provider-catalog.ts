import type { AssistantModelDto, AssistantPermissionPresetDto, AssistantThreadDto } from "../dto/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ProviderConnectionCatalog = {
  threads: AssistantThreadDto[];
  models: AssistantModelDto[];
  permissionPresets?: AssistantPermissionPresetDto[];
  modelWarning?: string;
};

export type ProviderCatalogRefreshItem = {
  target: string;
  provider: AssistantProvider;
  catalog: ProviderConnectionCatalog;
};

/** Application-facing provider catalog operations used by desktop connection workflows. */
export interface ProviderConnectionCatalogGatewayPort {
  connect(target: string, provider: AssistantProvider): Promise<ProviderConnectionCatalog>;
}

export interface ProviderCatalogRefreshPort {
  refresh(targets: string[]): Promise<ProviderCatalogRefreshItem[]>;
  refreshOtherProviders(target: string, selectedProvider: AssistantProvider, observer: ProviderCatalogRefreshObserverPort): Promise<void>;
}

export interface ProviderCatalogRefreshObserverPort {
  catalogAvailable(item: ProviderCatalogRefreshItem): void;
}

/** Provider operations needed to connect to a catalog and refresh its sessions. */
export interface ProviderCatalogPort {
  connect(target: string): Promise<ProviderConnectionCatalog>;
  refresh(target: string): Promise<AssistantThreadDto[]>;
  disconnect(target: string): Promise<void>;
}

export type ProviderCatalogPorts = Record<AssistantProvider, ProviderCatalogPort>;
