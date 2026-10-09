import type { AssistantSkill } from "../../../domain/assistant.js";
import { mapPiCommands } from "./session-command-mapper.js";

type PiCommandClient = {
  request(command: Record<string, unknown>): Promise<Record<string, unknown>>;
};

/** Reads and maps the skills exposed by a Pi RPC session. */
export async function listPiSkills(client: PiCommandClient): Promise<AssistantSkill[]> {
  const response = await client.request({ type: "get_commands" });
  return mapPiSkills(response.commands);
}

/** Builds the Pi slash-command prompt for a selected Pi skill. */
export async function buildPiSkillPrompt(client: PiCommandClient, skillId: string, text: string): Promise<string> {
  const name = skillId.startsWith("pi:") ? skillId.slice(3) : "";
  const commands = mapPiCommands((await client.request({ type: "get_commands" })).commands);
  const skill = commands.find((command) => command.source === "skill" && command.name === name);
  if (!skill) throw new Error("선택한 Pi skill을 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.");
  return `/${skill.name}${text.trim() ? ` ${text}` : ""}`;
}

export function mapPiSkills(value: unknown): AssistantSkill[] {
  return mapPiCommands(value).filter((command) => command.source === "skill").map((command) => ({
    id: `pi:${command.name}`,
    name: command.name.replace(/^skill:/, ""),
    description: command.description,
    provider: "Pi",
    scope: "Pi",
    enabled: true,
  }));
}
