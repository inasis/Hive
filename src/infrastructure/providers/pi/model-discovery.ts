import { defaultThinkingLevels, modelKey, readPiModel, readPiModels, readStringArray } from "./model-catalog.js";
import type { PiModel } from "./session-types.js";
import type { PiRpcProcess } from "./rpc-process.js";

export type PiDiscoveredModels = {
  models: PiModel[];
  defaultModel?: string;
};

/** Discovers configured models and their Thinking levels through Pi's RPC protocol. */
export async function discoverPiModels(probe: PiRpcProcess): Promise<PiDiscoveredModels> {
  let models: PiModel[] = [];
  let defaultModel: string | undefined;
  try {
    await probe.start();
    const initialState = await probe.request({ type: "get_state" });
    const initialModel = readPiModel(initialState.model);
    if (initialModel) defaultModel = modelKey(initialModel.provider, initialModel.id);
    const response = await probe.request({ type: "get_available_models" });
    models = readPiModels(response.models);
    for (const model of models) {
      try {
        await probe.request({ type: "set_model", provider: model.provider, modelId: model.id });
        const levels = await probe.request({ type: "get_available_thinking_levels" });
        model.thinkingLevels = readStringArray(levels.levels);
      } catch {
        // Older Pi versions may not expose thinking-level discovery over RPC.
        model.thinkingLevels = model.reasoning ? defaultThinkingLevels() : ["off"];
      }
    }
  } finally {
    await probe.close();
  }
  return { models, ...(defaultModel ? { defaultModel } : {}) };
}
