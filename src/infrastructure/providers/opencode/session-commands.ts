import type { ProviderSkillsPort, ProviderSkillCatalog } from "../../../application/ports/provider-skills.js";
import type { ProviderCommandsPort, ProviderCommandCatalog, ProviderCommandResult } from "../../../application/ports/provider-commands.js";
import type { AssistantCommand } from "../../../domain/assistant.js";
import type { OpenCodeSessionContext } from "./session-context.js";
import type { OpenCodeEventPublisher } from "./types.js";
import { mapOpenCodeSkill } from "./skill-mapper.js";

/** Implements OpenCode skill and slash-command catalog and execution. */
export class OpenCodeCommandAdapter implements ProviderSkillsPort, ProviderCommandsPort {
  constructor(
    private readonly context: OpenCodeSessionContext,
    private readonly publish: OpenCodeEventPublisher,
  ) {}

  async listSkills(target: string, threadId: string, cwd?: string): Promise<ProviderSkillCatalog> {
    const session = this.context.require(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before listing its skills");
    const directory = firstString(cwd, session.cwdByThread.get(threadId));
    const catalog = await this.context.loadSkills(session, threadId, directory);
    return { skills: catalog.skills.map(mapOpenCodeSkill), warnings: catalog.warnings };
  }

  async listCommands(target: string, threadId: string, cwd?: string): Promise<ProviderCommandCatalog> {
    const session = this.context.require(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before listing its commands");
    try {
      const directory = firstString(cwd, session.cwdByThread.get(threadId));
      const commands = await session.connection.listCommands(directory);
      return {
        commands: commands.map((command): AssistantCommand => ({ ...command, provider: "OpenCode", takesArguments: true })),
        warnings: [],
      };
    } catch (error) {
      return { commands: [], warnings: [`OpenCode 명령 목록을 가져오지 못했습니다: ${errorMessage(error)}`] };
    }
  }

  async runCommand(target: string, threadId: string, command: string, argumentsText: string): Promise<ProviderCommandResult> {
    const session = this.context.require(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before running its commands");
    const directory = firstString(session.cwdByThread.get(threadId));
    const available = await session.connection.listCommands(directory);
    if (!available.some((candidate) => candidate.name === command)) {
      throw new Error(`OpenCode 명령 /${command}을(를) 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.`);
    }
    const turnId = await session.connection.sendPrompt(
      target,
      threadId,
      `/${command}${argumentsText ? ` ${argumentsText}` : ""}`,
      session.settingsByThread.get(threadId)?.model ?? "",
      this.publish,
      { name: command, arguments: argumentsText },
    );
    return { executed: true, turnId };
  }
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
