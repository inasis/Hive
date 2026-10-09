import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteThread } from "../../shared/bridge";
import { replaceProviderThreads } from "../../shared/provider-thread-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

/** Load the other providers' session catalogs after the selected provider connects. */
export function useAdditionalProviderThreads(setters: {
  connectedTarget: string;
  setThreads: StateSetter<RemoteThread[]>;
  setProviderCatalogs: StateSetter<ProviderCatalogs>;
}) {
  const { providerCatalogRefresh } = useDesktopUiRuntime();
  const activeTarget = useRef(setters.connectedTarget);
  activeTarget.current = setters.connectedTarget;
  return useCallback((target: string, selectedProvider: AssistantProvider): void => {
    void providerCatalogRefresh.refreshOtherProviders(target, selectedProvider, {
      catalogAvailable: ({ target: resultTarget, provider, catalog }) => {
        if (activeTarget.current !== resultTarget) return;
        setters.setThreads((current) => replaceProviderThreads(current, catalog.threads, provider));
        setters.setProviderCatalogs((current) => ({
          ...current,
          [provider]: { models: catalog.models, warning: catalog.modelWarning ?? "", permissionPresets: catalog.permissionPresets ?? [] },
        }));
      },
    });
  }, [providerCatalogRefresh, setters.setThreads, setters.setProviderCatalogs]);
}
