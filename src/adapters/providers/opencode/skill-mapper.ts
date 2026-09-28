import { dirname } from "node:path";
import type { AssistantSkill } from "../../../domain/assistant.js";
import type { OpenCodeSkill } from "./types.js";

export function mapOpenCodeSkill(skill: OpenCodeSkill): AssistantSkill {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    provider: "OpenCode",
    scope: skill.path ? dirname(skill.path) : "OpenCode",
    enabled: skill.enabled,
  };
}
