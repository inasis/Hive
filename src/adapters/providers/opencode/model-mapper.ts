import type { AssistantModel } from "../../../domain/assistant.js";
import type { OpenCodeApiVersion } from "./api.js";

export type OpenCodeModel = AssistantModel;
type JsonObject = Record<string, unknown>;

export function defaultOpenCodeModel(models: OpenCodeModel[]): string | undefined {
  return models.find((model) => model.isDefault && !model.hidden)?.model ?? models.find((model) => !model.hidden)?.model;
}

export function mapOpenCodeModels(response: JsonObject, apiVersion: OpenCodeApiVersion = "v1", defaultModel?: JsonObject): OpenCodeModel[] {
  if (apiVersion === "v2") {
    const defaults = asObject(response.default) ?? defaultModel ?? {};
    const defaultProvider = firstString(defaults.providerID);
    const defaultId = firstString(defaults.id, defaults.modelID);
    const rows = [...dataArray(response)];
    if (defaultModel && defaultProvider && defaultId && !rows.some((value) => {
      const row = asObject(value);
      return firstString(row?.providerID) === defaultProvider && firstString(row?.id, row?.modelID) === defaultId;
    })) rows.push(defaultModel);
    return rows.flatMap((rowValue) => {
      const row = asObject(rowValue);
      const providerID = firstString(row?.providerID);
      const modelID = firstString(row?.id, row?.modelID);
      if (!row || !providerID || !modelID) return [];
      const key = `${providerID}/${modelID}`;
      return [{
        model: key,
        displayName: firstString(row.name) ?? key,
        description: firstString(asObject(row.compatibility)?.description) ?? "",
        defaultReasoningEffort: "",
        supportedReasoningEfforts: [],
        isDefault: defaultProvider === providerID && defaultId === modelID,
        hidden: row.enabled === false || row.status === "deprecated",
      }];
    }).sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
  }
  const providers = Array.isArray(response.providers) ? response.providers : [];
  const defaults = asObject(response.default) ?? {};
  const models: OpenCodeModel[] = [];
  for (const providerValue of providers) {
    const provider = asObject(providerValue);
    const providerId = provider?.id;
    const providerName = typeof provider?.name === "string" ? provider.name : providerId;
    const providerModels = asObject(provider?.models);
    if (typeof providerId !== "string" || !providerModels) continue;
    for (const [modelId, modelValue] of Object.entries(providerModels)) {
      const model = asObject(modelValue);
      if (!model) continue;
      const key = `${providerId}/${modelId}`;
      models.push({
        model: key,
        displayName: typeof model.name === "string" ? `${providerName} · ${model.name}` : key,
        description: typeof model.description === "string" ? model.description : "",
        defaultReasoningEffort: "",
        supportedReasoningEfforts: [],
        isDefault: defaults[providerId] === modelId || defaults[providerId] === key,
        hidden: model.status === "deprecated" || model.status === "disabled",
      });
    }
  }
  return models.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
}

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

export function mergeOpenCodeModels(primary: OpenCodeModel[], fallback: OpenCodeModel[]): OpenCodeModel[] {
  const models = new Map(primary.map((model) => [model.model, model]));
  for (const model of fallback) {
    const current = models.get(model.model);
    models.set(model.model, current ? { ...current, isDefault: current.isDefault || model.isDefault } : model);
  }
  return [...models.values()].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
}


export function parseOpenCodeModelId(value: string): { providerID: string; modelID: string } | undefined {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
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

function dataArray(value: unknown): unknown[] {
  const data = asObject(value)?.data;
  return Array.isArray(data) ? data : [];
}
