import type { AssistantProvider, RemoteModel, RemotePermissionPreset } from "../../../shared/bridge";

export type ProviderCatalogs = Partial<Record<AssistantProvider, {
  models: RemoteModel[];
  warning: string;
  permissionPresets?: RemotePermissionPreset[];
}>>;
