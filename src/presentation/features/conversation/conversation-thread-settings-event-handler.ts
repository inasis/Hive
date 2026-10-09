import type { Dispatch, SetStateAction } from "react";
import type { AssistantProvider } from "../../shared/bridge";
import type { UiBridgeEvent } from "../../shared/bridge-events";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";

type ThreadSettingsEventDependencies = {
  eventProvider: AssistantProvider;
  currentTarget: boolean;
  isActiveThread: boolean;
  threadViews: ThreadViewStorePort;
  setters: {
    setCurrentModel: Dispatch<SetStateAction<string>>;
    setCurrentEffort: Dispatch<SetStateAction<string | null>>;
    setCurrentPermissionProfile: Dispatch<SetStateAction<string | null>>;
    setCurrentModeId: Dispatch<SetStateAction<string | null>>;
    setProviderCatalogs: Dispatch<SetStateAction<ProviderCatalogs>>;
  };
};

/** Synchronizes persisted thread settings and model capabilities from a provider event. */
export function applyThreadSettingsEvent(
  event: UiBridgeEvent,
  dependencies: ThreadSettingsEventDependencies,
): boolean {
  if (event.type !== "threadSettingsUpdated") return false;
  const { eventProvider, currentTarget, isActiveThread, threadViews, setters } = dependencies;
  const settings = event.settings;
  const view = threadViews.get(event.target, eventProvider, event.threadId);
  if (view) {
    const model = settings.model ?? view.model;
    const permissionProfile = settings.permissionProfile ?? view.permissionProfile;
    const currentModeId = settings.modeId ?? view.currentModeId;
    threadViews.update(event.target, eventProvider, event.threadId, (current) => ({
      ...current,
      model,
      effort: settings.effort,
      permissionProfile,
      currentModeId,
    }));
    if (isActiveThread) {
      setters.setCurrentModel(model);
      setters.setCurrentEffort(settings.effort);
      setters.setCurrentPermissionProfile(permissionProfile);
      setters.setCurrentModeId(currentModeId);
    }
  }

  const supportedReasoningEfforts = settings.supportedReasoningEfforts;
  if (currentTarget && supportedReasoningEfforts) {
    setters.setProviderCatalogs((current) => {
      const catalog = current[eventProvider];
      if (!catalog) return current;
      const selectedModel = settings.model ?? view?.model;
      if (!selectedModel) return current;
      return {
        ...current,
        [eventProvider]: {
          ...catalog,
          models: catalog.models.map((model) => model.model === selectedModel
            ? { ...model, supportedReasoningEfforts }
            : model),
        },
      };
    });
  }
  return true;
}
