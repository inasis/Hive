import { dirname } from "node:path";
import type { OpenCodeSkill } from "./types.js";

export function buildOpenCodeSkillInput(skill: OpenCodeSkill, request: string): string {
  const skillDirectory = skill.path ? dirname(skill.path) : "the skill's directory";
  const selectedTask = request.trim() || "Apply this skill to the current session and ask me if you need more input.";
  return [
    `Use the explicitly selected OpenCode skill '${skill.id}' (${skill.name}). Follow its instructions and resolve relative skill resources from '${skillDirectory}'.`,
    "",
    `--- BEGIN OPENCODE SKILL: ${skill.id} ---`,
    skill.content,
    `--- END OPENCODE SKILL: ${skill.id} ---`,
    "",
    `User request: ${selectedTask}`,
  ].join("\n");
}
