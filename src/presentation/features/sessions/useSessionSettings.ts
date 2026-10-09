import { useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteMode, RemoteModel, RemotePermissionPreset } from "../../shared/bridge";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import { effortLabel } from "../../shared/effort-label";
import type { ProviderCatalogs } from "../../shared/provider-ui-state";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { SessionSettingsChange } from "./session-settings-types";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SessionSettingsOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    provider: AssistantProvider;
    providerName: string;
    currentModel: string;
    currentEffort: string | null;
    models: RemoteModel[];
    modes: RemoteMode[];
    permissionPresets: RemotePermissionPreset[];
  };
  refs: {
    threadViews: ThreadViewStorePort;
  };
  setters: {
    setProviderCatalogs: StateSetter<ProviderCatalogs>;
    setCurrentModel: StateSetter<string>;
    setCurrentEffort: StateSetter<string | null>;
    setCurrentPermissionProfile: StateSetter<string | null>;
    setCurrentModeId: StateSetter<string | null>;
    setNotice: StateSetter<string>;
  };
};

/** Own provider session-setting updates and their local view/catalog synchronization. */
export function useSessionSettings({ state, refs, setters }: SessionSettingsOptions) {
  const { bridge } = useDesktopUiRuntime();
  const [updatingSettings, setUpdatingSettings] = useState(false);

  const updateSettings = async (change: SessionSettingsChange): Promise<void> => {
    if (!state.connectedTarget || !state.activeThreadId) return;
    setUpdatingSettings(true);
    setters.setNotice(`${state.providerName} 설정을 변경하는 중…`);
    try {
      const requestBase = {
        target: state.connectedTarget,
        threadId: state.activeThreadId,
      };
      const provider = state.provider;
      let result;
      if (change.permissionProfile !== undefined) {
        if (!assistantProviderSupports(provider, "permissionProfileUpdates")) {
          throw new Error(`${state.providerName} does not support changing permission profiles.`);
        }
        result = await bridge.bridgeRpc.request.updateThreadSettings({ ...requestBase, provider, permissionProfile: change.permissionProfile });
      } else if (change.modeId !== undefined) {
        if (!assistantProviderSupports(provider, "sessionModes")) {
          throw new Error(`${state.providerName} does not support changing session modes.`);
        }
        result = await bridge.bridgeRpc.request.updateThreadSettings({ ...requestBase, provider, modeId: change.modeId });
      } else if (change.effort !== undefined) {
        if (!assistantProviderSupports(provider, "reasoningEffort")) {
          throw new Error(`${state.providerName} does not support changing reasoning effort.`);
        }
        result = await bridge.bridgeRpc.request.updateThreadSettings({
          ...requestBase,
          provider,
          ...(change.model !== undefined ? { model: change.model } : {}),
          effort: change.effort,
        });
      } else {
        result = await bridge.bridgeRpc.request.updateThreadSettings({ ...requestBase, provider, model: change.model });
      }
      const view = refs.threadViews.get(state.connectedTarget, state.provider, state.activeThreadId);
      if (view) {
        refs.threadViews.update(state.connectedTarget, state.provider, state.activeThreadId, (current) => ({
          ...current,
          model: result.model ?? view.model,
          effort: result.effort ?? view.effort,
          permissionProfile: result.permissionProfile ?? view.permissionProfile,
          currentModeId: result.currentModeId ?? view.currentModeId,
        }));
      }
      if (result.model) setters.setCurrentModel(result.model);
      if (result.effort) setters.setCurrentEffort(result.effort);
      if (result.permissionProfile) setters.setCurrentPermissionProfile(result.permissionProfile);
      if (result.currentModeId) setters.setCurrentModeId(result.currentModeId);
      if (result.supportedReasoningEfforts) {
        const selectedModelId = result.model ?? state.currentModel;
        setters.setProviderCatalogs((current) => {
          const catalog = current[state.provider];
          if (!catalog) return current;
          return {
            ...current,
            [state.provider]: {
              ...catalog,
              models: catalog.models.map((model) => model.model === selectedModelId
                ? { ...model, supportedReasoningEfforts: result.supportedReasoningEfforts! }
                : model),
            },
          };
        });
      }
      const modelName = change.model
        ? state.models.find((model) => model.model === change.model)?.displayName ?? change.model
        : undefined;
      setters.setNotice(change.model
        ? `${modelName} 모델로 변경했습니다. 다음 턴부터 적용됩니다.`
        : change.permissionProfile
          ? `권한을 ${state.permissionPresets.find((preset) => preset.id === change.permissionProfile)?.label ?? change.permissionProfile}로 변경했습니다. 다음 턴부터 적용됩니다.`
          : change.modeId
            ? `${state.providerName} 세션 모드를 ${state.modes.find((mode) => mode.id === change.modeId)?.name ?? change.modeId}(으)로 바꿨습니다.`
            : `사고를 ${effortLabel(change.effort ?? "")}로 변경했습니다. 다음 턴부터 적용됩니다.`);
    } catch (error) {
      setters.setNotice(errorMessage(error));
    } finally {
      setUpdatingSettings(false);
    }
  };

  const changeModel = (modelId: string): void => {
    const model = state.models.find((candidate) => candidate.model === modelId);
    if (!model) return;
    const effort = state.currentEffort && model.supportedReasoningEfforts.some((option) => option.reasoningEffort === state.currentEffort)
      ? state.currentEffort
      : model.defaultReasoningEffort;
    void updateSettings({ model: model.model, ...(effort ? { effort } : {}) });
  };

  return { updatingSettings, updateSettings, changeModel };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
