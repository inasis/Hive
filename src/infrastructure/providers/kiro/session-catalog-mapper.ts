import type { AssistantMode, AssistantModel, AssistantSkill, ReasoningEffort } from "../../../domain/assistant.js";
import { listKiroSkills } from "./skill-catalog.js";
import type { KiroRemoteSession } from "./session-types.js";
import { asObject, firstString, type JsonObject } from "./session-utils.js";

export function kiroModes(result: JsonObject): AssistantMode[] {
  const state = asObject(result.modes);
  const available = Array.isArray(state?.availableModes) ? state.availableModes : Array.isArray(state?.modes) ? state.modes : [];
  return available.flatMap((value): AssistantMode[] => {
    const mode = asObject(value);
    const id = firstString(mode?.id, mode?.modeId);
    if (!mode || !id) return [];
    return [{ id, name: firstString(mode.name, mode.title) ?? id, description: firstString(mode.description) ?? "" }];
  });
}

export async function kiroEffortOptions(session: KiroRemoteSession, threadId: string): Promise<{ options: ReasoningEffort[]; current?: string }> {
  try {
    const raw = await session.connection.commandOptions(threadId, "effort", "");
    const options = raw.flatMap((option): ReasoningEffort[] => {
      const value = firstString(option.value, option.id, option.name);
      if (!value) return [];
      return [{ reasoningEffort: value, description: firstString(option.description, option.label) ?? value }];
    });
    const current = raw.find((option) => option.current === true);
    const currentValue = current ? firstString(current.value, current.id, current.name) : undefined;
    return { options, ...(currentValue ? { current: currentValue } : {}) };
  } catch {
    return { options: [] };
  }
}

export function withKiroEffortOptions(models: AssistantModel[], modelId: string, options: ReasoningEffort[]): AssistantModel[] {
  if (models.some((model) => model.model === modelId)) {
    return models.map((model) => model.model === modelId ? { ...model, supportedReasoningEfforts: options } : model);
  }
  return [...models, {
    model: modelId,
    displayName: modelId === "auto" ? "Auto" : modelId,
    description: modelId === "auto" ? "Kiro가 요청에 맞는 모델을 선택합니다." : "현재 세션에서 사용 중인 Kiro 모델입니다.",
    defaultReasoningEffort: "",
    supportedReasoningEfforts: options,
    isDefault: modelId === "auto",
    hidden: false,
  }];
}

export async function loadKiroSkills(session: KiroRemoteSession, target: string, threadId: string, cwd: string): Promise<AssistantSkill[]> {
  try {
    const skills = await listKiroSkills(target, cwd);
    const remote = skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      provider: "Kiro",
      scope: skill.scope,
      enabled: skill.enabled,
    }));
    session.skillsByThread.set(threadId, remote);
    return remote;
  } catch {
    session.skillsByThread.set(threadId, []);
    return [];
  }
}
