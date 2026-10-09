import type { CodexAppServerApi } from "./app-server.js";
import type { AvailableSkill, SkillCatalog, SkillProvider } from "../../../application/ports/skills.js";
import { asObject, errorMessage, type JsonObject } from "./protocol-utils.js";
import { listPiSkills } from "../../workspace/pi-skills.js";

/** Load Codex's own inventory and Pi's conventional skill directories on the remote host. */
export async function discoverCodexSkills(
  api: CodexAppServerApi,
  target: string,
  cwd: string | undefined,
): Promise<SkillCatalog> {
  const skills = new Map<string, AvailableSkill>();
  const warnings: string[] = [];

  try {
    const response = await api.listSkills(cwd);
    for (const entry of arrayOfObjects(asObject(response)?.data)) {
      for (const skill of arrayOfObjects(entry.skills)) {
        const parsed = parseCodexSkill(skill);
        if (parsed) skills.set(skillKey(parsed), parsed);
      }
    }
  } catch (error) {
    warnings.push(`Codex skill inventory unavailable: ${errorMessage(error)}`);
  }

  try {
    for (const skill of await listPiSkills(target, cwd)) {
      skills.set(skillKey(skill), skill);
    }
  } catch (error) {
    warnings.push(`Pi skill inventory unavailable: ${errorMessage(error)}`);
  }

  return {
    skills: [...skills.values()].sort((left, right) => {
      const providerOrder = { Codex: 0, Shared: 1, Pi: 2 };
      return (
        providerOrder[left.provider] - providerOrder[right.provider] ||
        left.scope.localeCompare(right.scope) ||
        left.name.localeCompare(right.name)
      );
    }),
    warnings,
  };
}

function parseCodexSkill(value: JsonObject): AvailableSkill | undefined {
  const name = stringValue(value.name);
  const path = stringValue(value.path);
  if (!name || !path) return undefined;

  const interfaceInfo = asObject(value.interface);
  const provider: SkillProvider = path.includes("/.agents/skills/") ? "Shared" : "Codex";
  const skill: AvailableSkill = {
    name,
    description: stringValue(value.description) ?? "No description provided",
    path,
    provider,
    scope: stringValue(value.scope)?.toUpperCase() ?? "AVAILABLE",
    enabled: value.enabled !== false,
  };
  const defaultPrompt = stringValue(interfaceInfo?.defaultPrompt);
  if (defaultPrompt) skill.defaultPrompt = defaultPrompt;
  return skill;
}

function skillKey(skill: AvailableSkill): string {
  return `${skill.provider}\0${skill.name}\0${skill.path}`;
}

function arrayOfObjects(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is JsonObject =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
