import { parseOpenCodeModelId, type OpenCodeModel } from "./model-mapper.js";

type JsonObject = Record<string, unknown>;

export function mapOpenCodeConfiguredModels(response: unknown, defaultModel?: JsonObject): OpenCodeModel[] {
  const configDocuments = getOpenCodeConfigDocuments(response);
  const config = mergeOpenCodeConfigDocuments(configDocuments);
  const providers = asObject(config.providers) ?? asObject(config.provider) ?? {};
  const configModel = asObject(config.model);
  const configuredDefault = typeof config.model === "string" ? parseOpenCodeModelId(config.model) : undefined;
  const defaultProvider = firstString(defaultModel?.providerID, configModel?.providerID, configuredDefault?.providerID);
  const defaultId = firstString(defaultModel?.id, defaultModel?.modelID, configModel?.model, configModel?.id, configuredDefault?.modelID);
  const models: OpenCodeModel[] = [];
  for (const [providerID, providerValue] of Object.entries(providers)) {
    const provider = asObject(providerValue);
    const providerModels = asObject(provider?.models);
    if (!provider || !providerModels || provider.disabled === true) continue;
    for (const [modelID, modelValue] of Object.entries(providerModels)) {
      const model = asObject(modelValue);
      if (!model) continue;
      const key = `${providerID}/${modelID}`;
      models.push({
        model: key,
        displayName: firstString(model.name) ? `${firstString(provider.name, providerID)} · ${firstString(model.name)}` : key,
        description: firstString(model.description) ?? "",
        defaultReasoningEffort: "",
        supportedReasoningEfforts: [],
        isDefault: defaultProvider === providerID && defaultId === modelID,
        hidden: model.enabled === false || model.disabled === true || model.status === "deprecated" || model.status === "disabled",
      });
    }
  }
  return models.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
}

function getOpenCodeConfigDocuments(response: unknown): JsonObject[] {
  const value = unwrapData(response);
  if (Array.isArray(value)) {
    return value.flatMap((entryValue) => {
      const entry = asObject(entryValue);
      const info = entry?.type === "document" ? asObject(entry.info) : undefined;
      return info ? [info] : [];
    });
  }
  const config = asObject(value);
  if (!config) return [];
  for (let depth = 0; depth < 3; depth += 1) {
    const nested = asObject(config.config);
    if (!nested) break;
    return getOpenCodeConfigDocuments(nested);
  }
  return [config];
}

function mergeOpenCodeConfigDocuments(documents: JsonObject[]): JsonObject {
  const merged: JsonObject = {};
  const providers: JsonObject = {};
  for (const document of documents) {
    for (const [key, value] of Object.entries(document)) {
      if (key !== "providers" && key !== "provider") {
        merged[key] = value;
        continue;
      }
      const providerEntries = asObject(value);
      if (!providerEntries) continue;
      for (const [providerID, providerValue] of Object.entries(providerEntries)) {
        const nextProvider = asObject(providerValue);
        if (!nextProvider) continue;
        const currentProvider = asObject(providers[providerID]) ?? {};
        providers[providerID] = {
          ...currentProvider,
          ...nextProvider,
          models: {
            ...(asObject(currentProvider.models) ?? {}),
            ...(asObject(nextProvider.models) ?? {}),
          },
        };
      }
    }
  }
  if (Object.keys(providers).length > 0) merged.providers = providers;
  return merged;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function unwrapData(value: unknown): unknown {
  const record = asObject(value);
  return record && "data" in record ? record.data : value;
}
