import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";
import type { AvailableSkill } from "../../application/ports/skills.js";
import { MAX_PI_SKILL_FILE_BYTES } from "./pi-skill-limits.js";
import { listLocalPiSkills, readLocalPiSkill } from "./pi-skills-local.js";
import { listSshPiSkills, readSshPiSkill } from "./pi-skills-ssh.js";

/** Read a Pi skill only after the user explicitly invokes it. */
export async function readPiSkill(target: string, skill: AvailableSkill): Promise<string> {
  if (skill.provider !== "Pi" || (!skill.path.startsWith("/") && target !== LOCAL_WORKSPACE_TARGET)) {
    throw new Error("Only a discovered Pi skill can be read through this command");
  }
  const content = target === LOCAL_WORKSPACE_TARGET
    ? await readLocalPiSkill(skill.path)
    : await readSshPiSkill(target, skill.path);
  if (Buffer.byteLength(content, "utf8") >= MAX_PI_SKILL_FILE_BYTES) {
    throw new Error("Pi skill entrypoint is larger than 128 KiB");
  }
  return content;
}

export async function listPiSkills(target: string, cwd: string | undefined): Promise<AvailableSkill[]> {
  if (target === LOCAL_WORKSPACE_TARGET) return listLocalPiSkills(cwd);
  return listSshPiSkills(target, cwd);
}
