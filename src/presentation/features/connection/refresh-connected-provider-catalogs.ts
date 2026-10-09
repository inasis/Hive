import type { Dispatch, SetStateAction } from "react";
import type { ProviderCatalogRefreshPort } from "../../../application/ports/provider-catalog.js";
import type { DaemonConnectionsPort } from "../../shared/daemon-connections";
import type { RemoteThread } from "../../shared/bridge";
import { replaceProviderThreads } from "../../shared/provider-thread-state";
import type { BridgeConnectionState, ProviderCatalogs } from "../../shared/provider-ui-state";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type RefreshConnectedProviderCatalogsOptions = {
  state: {
    connectedTarget: string;
    isDaemonClient: boolean;
    threads: RemoteThread[];
  };
  getActiveTarget(): string;
  daemonConnections: DaemonConnectionsPort;
  providerCatalogRefresh: ProviderCatalogRefreshPort;
  setters: {
    setConnectionState: StateSetter<BridgeConnectionState>;
    setNotice: StateSetter<string>;
    setThreads: StateSetter<RemoteThread[]>;
    setProviderCatalogs: StateSetter<ProviderCatalogs>;
  };
};

/** Refresh connected provider catalogs and apply them to the currently selected target. */
export async function refreshConnectedProviderCatalogs({
  state,
  getActiveTarget,
  daemonConnections,
  providerCatalogRefresh,
  setters,
}: RefreshConnectedProviderCatalogsOptions): Promise<void> {
  if (!state.connectedTarget) return;
  try {
    const targets = state.isDaemonClient
      ? daemonConnections.snapshot().filter((connection) => connection.state === "connected").map((connection) => connection.target)
      : [state.connectedTarget];
    const available = await providerCatalogRefresh.refresh(targets);
    if (!available.length) throw new Error("어떤 프로바이더에서도 세션 목록을 불러오지 못했습니다.");
    if (state.isDaemonClient && getActiveTarget() !== state.connectedTarget) return;
    for (const item of available) {
      if (item.target !== state.connectedTarget) continue;
      setters.setThreads((current) => replaceProviderThreads(current, item.catalog.threads, item.provider));
      setters.setProviderCatalogs((current) => ({
        ...current,
        [item.provider]: {
          models: item.catalog.models,
          warning: item.catalog.modelWarning ?? "",
          permissionPresets: item.catalog.permissionPresets ?? [],
        },
      }));
    }
    const total = available.reduce((count, item) => count + item.catalog.threads.length, 0);
    setters.setNotice(`연결된 호스트의 세션 목록을 새로 고쳤습니다 · ${total}개`);
  } catch (error) {
    setters.setNotice(errorMessage(error));
    if (!state.threads.length) setters.setConnectionState("disconnected");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
