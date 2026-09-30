import { useCallback, type Dispatch, type SetStateAction } from "react";
import { ASSISTANT_PROVIDERS } from "../../../../../../src/domain/provider-catalog.js";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import { replaceProviderThreads } from "../../shared/provider-thread-state";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import { bridgeRpc } from "../../bridgeClient";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

/** Load the other providers' session catalogs after the selected provider connects. */
export function useAdditionalProviderThreads(setters: {
  setThreads: StateSetter<RemoteThread[]>;
  setProviderCatalogs: StateSetter<ProviderCatalogs>;
}) {
  return useCallback((target: string, selectedProvider: AssistantProvider): void => {
    for (const provider of ASSISTANT_PROVIDERS.map((item) => item.id).filter((id) => id !== selectedProvider)) {
      void bridgeRpc.request.connect({ target, provider }).then((result) => {
        setters.setThreads((current) => replaceProviderThreads(current, result.threads, provider));
        setters.setProviderCatalogs((current) => ({
          ...current,
          [provider]: { models: result.models, warning: result.modelWarning ?? "", permissionPresets: result.permissionPresets ?? [] },
        }));
      }).catch(() => undefined);
    }
  }, [setters.setThreads, setters.setProviderCatalogs]);
}
