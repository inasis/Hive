import type { OpenCodeApiVersion } from "./api.js";
import type { OpenCodeHttpClient } from "./http-client.js";
import {
  mapOpenCodeConfiguredModels,
  mapOpenCodeModels,
  mergeOpenCodeModels,
  type OpenCodeModel,
} from "./model-mapper.js";

type JsonObject = Record<string, unknown>;

/** Load and merge OpenCode v1/v2 model endpoints for a workspace directory. */
export async function loadOpenCodeModelCatalog(
  http: OpenCodeHttpClient,
  apiVersion: OpenCodeApiVersion,
  directory?: string,
): Promise<{ models: OpenCodeModel[]; modelWarning?: string }> {
  const modelDirectory = directory?.trim();
  const modelQuery = modelDirectory
    ? apiVersion === "v2" ? { locationDirectory: modelDirectory } : { directory: modelDirectory }
    : undefined;
  const modelRequestInit: RequestInit = apiVersion === "v2" && modelDirectory
    ? { headers: { "x-opencode-directory": encodeURIComponent(modelDirectory) } }
    : {};
  const modelReadErrors: string[] = [];
  const readOptional = async (path: string): Promise<unknown | undefined> => {
    try {
      return await http.request(path, modelQuery, modelRequestInit);
    } catch (error) {
      modelReadErrors.push(`${path}: ${errorMessage(error)}`);
      return undefined;
    }
  };
  const [modelResponse, defaultResponse] = await Promise.all([
    apiVersion === "v2"
      ? readOptional("/api/model")
      : readOptional("/config/providers"),
    apiVersion === "v2" ? readOptional("/api/model/default") : Promise.resolve(undefined),
  ]);
  const defaultModel = asObject(unwrapData(defaultResponse)) ?? undefined;
  let models = mapOpenCodeModels(asObject(unwrapData(modelResponse)) ?? {}, apiVersion, defaultModel);
  const modelSourceDetails = [`${apiVersion === "v2" ? "/api/model" : "/config/providers"}: ${models.filter((model) => !model.hidden).length}개`];
  if (apiVersion === "v2") {
    const configResponse = await readOptional("/api/config");
    if (configResponse !== undefined) {
      const configuredModels = mapOpenCodeConfiguredModels(configResponse, defaultModel);
      modelSourceDetails.push(`/api/config: ${configuredModels.filter((model) => !model.hidden).length}개`);
      models = mergeOpenCodeModels(models, configuredModels);
    }
  } else {
    const [configuredProviders, configResponse] = await Promise.all([
      readOptional("/config/providers"),
      readOptional("/config"),
    ]);
    if (configuredProviders) {
      const configuredProviderModels = mapOpenCodeModels(asObject(configuredProviders) ?? {}, "v1");
      modelSourceDetails.push(`/config/providers: ${configuredProviderModels.filter((model) => !model.hidden).length}개`);
      models = mergeOpenCodeModels(models, configuredProviderModels);
    }
    if (configResponse !== undefined) {
      const configuredModels = mapOpenCodeConfiguredModels(configResponse, defaultModel);
      modelSourceDetails.push(`/config: ${configuredModels.filter((model) => !model.hidden).length}개`);
      models = mergeOpenCodeModels(models, configuredModels);
    }
  }
  const modelWarning = models.some((model) => !model.hidden)
    ? undefined
    : `OpenCode ${apiVersion} API에서 선택 가능한 모델을 찾지 못했습니다. 가져온 모델 수: ${[...modelSourceDetails, ...modelReadErrors].join("; ") || "모델 목록과 설정 응답 없음"}`;
  return { models, ...(modelWarning ? { modelWarning } : {}) };
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function unwrapData(value: unknown): unknown {
  const record = asObject(value);
  return record && "data" in record ? record.data : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
