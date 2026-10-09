import type { AssistantModel } from "../../../domain/assistant.js";
import { asObject } from "./session-json-values.js";
import type { PiModel } from "./session-types.js";

export function toAssistantModel(model: PiModel, isDefault: boolean): AssistantModel {
  const key = modelKey(model.provider, model.id);
  const levels = normalizeThinkingLevels(model.thinkingLevels);
  return {
    model: key,
    displayName: model.name || model.id,
    description: "",
    defaultReasoningEffort: levels.includes("medium") ? "medium" : levels.find((level) => level !== "off") ?? "",
    supportedReasoningEfforts: levels.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort === "off" ? "추론 단계를 사용하지 않습니다." : `Pi ${reasoningEffort} thinking 수준`,
    })),
    isDefault,
    hidden: false,
  };
}

export function readPiModels(value: unknown): PiModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const model = asObject(item);
    const provider = optionalString(model?.provider);
    const id = optionalString(model?.id);
    if (!model || !provider || !id) return [];
    return [{
      provider,
      id,
      name: optionalString(model.name) ?? id,
      contextWindow: positiveInteger(model.contextWindow, 32768),
      maxTokens: positiveInteger(model.maxTokens, 4096),
      reasoning: model.reasoning === true,
      input: readStringArray(model.input),
      thinkingLevels: [],
    }];
  });
}

export function readPiModel(value: unknown): PiModel | undefined {
  return readPiModels([value])[0];
}

export function parseModelId(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) throw new Error("잘못된 Pi 모델 식별자입니다.");
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

export function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function defaultThinkingLevels(): string[] {
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
}

function normalizeThinkingLevels(levels: string[]): string[] {
  const allowed = new Set(defaultThinkingLevels());
  return [...new Set(levels.filter((level) => allowed.has(level)))];
}
