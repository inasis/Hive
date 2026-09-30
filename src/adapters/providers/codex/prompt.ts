import { dirname } from "node:path";
import type { AvailableSkill, SkillCatalog } from "../../../application/ports/skills.js";
import { readPiSkill } from "../../workspace/pi-skills.js";

/** Expand the existing /skill selector into a provider-compatible user prompt. */
export async function buildCodexPrompt(target: string, text: string, catalog: SkillCatalog | undefined): Promise<string> {
  const invocation = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/i);
  if (!invocation) return text;
  if (!catalog) throw new Error("Remote skills have not been loaded for this session");

  const selector = invocation[1]!;
  const request = invocation[2]?.trim() ?? "";
  const [prefix, ...nameParts] = selector.split(":");
  const qualified = ["codex", "pi", "shared"].includes(prefix?.toLowerCase() ?? "");
  const provider = qualified ? prefix!.toLowerCase() : undefined;
  const name = qualified ? nameParts.join(":") : selector;
  const matches = catalog.skills.filter((skill) => skill.name === name && (!provider || skill.provider.toLowerCase() === provider));
  if (matches.length > 1) {
    const choices = matches.map((skill) => `/skill:${skill.provider.toLowerCase()}:${skill.name}`).join("  ");
    throw new Error(`Skill name '${name}' is ambiguous. Choose ${choices}`);
  }
  const skill = matches[0];
  if (!skill) throw new Error(`No available skill named '${selector}'. Open Skills to browse remote skills.`);
  if (!skill.enabled) throw new Error(`The '${skill.name}' skill is disabled`);
  return buildCodexSkillInput(target, skill, request);
}

export async function buildCodexSkillInput(target: string, skill: AvailableSkill, request: string): Promise<string> {
  if (skill.provider !== "Pi") {
    const prompt = skill.defaultPrompt?.trim() || `Use $${skill.name} to handle this request.`;
    return request ? `${prompt}\n\nUser request: ${request}` : prompt;
  }
  const instructions = await readPiSkill(target, skill);
  const selectedTask = request || "Apply this skill to the current session and ask me if you need more input.";
  const skillDirectory = dirname(skill.path);
  return [
    `Use the explicitly selected Pi skill '${skill.name}'. Follow its instructions and resolve any relative skill resources from '${skillDirectory}'.`,
    "The skill remains on the daemon host; Hive only sends its entrypoint for this invocation.",
    "",
    `--- BEGIN PI SKILL: ${skill.name} ---`,
    instructions,
    `--- END PI SKILL: ${skill.name} ---`,
    "",
    `User request: ${selectedTask}`,
  ].join("\n");
}

/** Preserve the interactive CLI's wording while keeping remote skill reads in the adapter. */
export async function buildCodexCliSkillInput(target: string, skill: AvailableSkill, request: string): Promise<string> {
  if (skill.provider !== "Pi") {
    const prompt = skill.defaultPrompt?.trim() || `Use $${skill.name} to handle this request.`;
    return request ? `${prompt}\n\nUser request: ${request}` : prompt;
  }

  const instructions = await readPiSkill(target, skill);
  const selectedTask = request || "Apply this skill to the current session and ask me if you need more input.";
  const skillDirectory = dirname(skill.path);
  return [
    `Use the explicitly selected Pi skill '${skill.name}'. Follow its instructions and resolve any relative skill resources from '${skillDirectory}'.`,
    "The skill remains on the remote host; Hive only sends its entrypoint for this invocation.",
    "",
    `--- BEGIN PI SKILL: ${skill.name} ---`,
    instructions,
    `--- END PI SKILL: ${skill.name} ---`,
    "",
    `User request: ${selectedTask}`,
  ].join("\n");
}
