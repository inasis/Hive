import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import { asObject } from "./session-json-values.js";
import { PiSessionContext } from "./session-context.js";
import { modelKey, parseModelId } from "./model-catalog.js";
import type { PiEventRecordHandler } from "./session-types.js";

/** Applies model and Thinking selections through Pi's session RPC. */
export class PiThreadSettingsAdapter implements ProviderSettingsPort {
  constructor(private readonly context: PiSessionContext, private readonly onRecord: PiEventRecordHandler) {}

  async updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    if (input.permissionProfile || input.modeId) {
      throw new Error("Pi RPC does not expose Hive permission profiles or Codex-style session modes.");
    }
    const session = await this.context.open(target, threadId, (record) => this.onRecord(target, () => threadId, record));
    const state = this.context.require(target);
    const selectedModel = input.model ?? session.model;
    if (!selectedModel) throw new Error("Select a Pi model to update");
    const catalogModel = state.models.find((model) => model.model === selectedModel && !model.hidden);
    if (!catalogModel) {
      throw new Error("The selected model is not in Pi's configured model list.");
    }
    if (input.model === undefined && input.effort === undefined) throw new Error("Select a model or Thinking level to update");
    const parsed = parseModelId(selectedModel);
    const piModel = state.piModels.get(selectedModel);
    if (!piModel) throw new Error("Pi model metadata is no longer available. Refresh the provider connection.");
    let thinkingLevels = piModel.thinkingLevels;
    if (!thinkingLevels.length) thinkingLevels = readStringArray((await session.client.request({ type: "get_available_thinking_levels" })).levels);
    if (input.effort && !thinkingLevels.includes(input.effort)) {
      throw new Error(`${input.effort} Thinking level is not supported by ${catalogModel.displayName}.`);
    }
    if (input.model) await session.client.request({ type: "set_model", provider: parsed.provider, modelId: parsed.id });
    if (input.effort) await session.client.request({ type: "set_thinking_level", level: input.effort });
    const current = await session.client.request({ type: "get_state" });
    const currentModel = asObject(current.model);
    const updatedModel = currentModel && typeof currentModel.provider === "string" && typeof currentModel.id === "string"
      ? modelKey(currentModel.provider, currentModel.id)
      : selectedModel;
    session.model = updatedModel;
    const effort = optionalString(current.thinkingLevel) ?? input.effort ?? session.effort;
    if (effort) session.effort = effort;
    else delete session.effort;
    piModel.thinkingLevels = thinkingLevels;
    catalogModel.supportedReasoningEfforts = toReasoningOptions(thinkingLevels);
    catalogModel.defaultReasoningEffort = thinkingLevels.includes("medium") ? "medium" : thinkingLevels.find((level) => level !== "off") ?? "";
    session.thread = { ...session.thread, updatedAt: Date.now() };
    return {
      updated: true,
      model: updatedModel,
      ...(session.effort ? { effort: session.effort } : {}),
      supportedReasoningEfforts: catalogModel.supportedReasoningEfforts,
    };
  }
}

function toReasoningOptions(levels: string[]) {
  return levels.map((reasoningEffort) => ({
    reasoningEffort,
    description: reasoningEffort === "off" ? "추론 단계를 사용하지 않습니다." : `Pi ${reasoningEffort} thinking 수준`,
  }));
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
