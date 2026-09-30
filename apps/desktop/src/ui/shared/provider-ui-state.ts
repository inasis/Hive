import type { AssistantProvider, RemoteModel, RemotePermissionPreset } from "../../shared/bridge";

export type BridgeConnectionState = "disconnected" | "connecting" | "connected";

export type ProviderCatalogs = Partial<Record<AssistantProvider, {
  models: RemoteModel[];
  warning: string;
  permissionPresets?: RemotePermissionPreset[];
}>>;
