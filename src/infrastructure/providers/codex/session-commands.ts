import type { SkillCatalog, AvailableSkill } from "../../../application/ports/skills.js";
import type { CodexCliSkillPort } from "../../../application/ports/codex-cli.js";
import type { ProviderSkillsPort, ProviderSkillCatalog } from "../../../application/ports/provider-skills.js";
import type { ProviderCommandsPort, ProviderCommandCatalog, ProviderCommandResult } from "../../../application/ports/provider-commands.js";
import type { AssistantCommand, AssistantGoal } from "../../../domain/assistant.js";
import { discoverCodexSkills } from "./skill-catalog.js";
import { buildCodexCliSkillInput } from "./prompt.js";
import { mapCodexSkill } from "./mapper.js";
import type { CodexSessionContext } from "./session-context.js";
import { asObject, errorMessage, firstString } from "./protocol-utils.js";

/** Implements Codex skills, slash commands, and interactive CLI skill operations. */
export class CodexSessionCommandAdapter implements ProviderSkillsPort, ProviderCommandsPort, CodexCliSkillPort {
  constructor(private readonly context: CodexSessionContext) {}

  async listCliSkills(target: string, threadId: string): Promise<SkillCatalog> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before listing its skills");
    const cached = session.skillsByThread.get(threadId);
    if (cached) return cached;
    const catalog = await discoverCodexSkills(session.api, target, undefined);
    session.skillsByThread.set(threadId, catalog);
    return catalog;
  }

  async buildSkillInput(target: string, threadId: string, skill: AvailableSkill, request: string): Promise<string> {
    const session = this.context.get(target);
    if (!session?.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before invoking its skills");
    return buildCodexCliSkillInput(target, skill, request);
  }

  async listSkills(target: string, threadId: string, cwd?: string): Promise<ProviderSkillCatalog> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before listing its skills");
    const catalog = await discoverCodexSkills(session.api, target, firstString(cwd));
    session.skillsByThread.set(threadId, catalog);
    return { skills: catalog.skills.map(mapCodexSkill), warnings: catalog.warnings };
  }

  async listCommands(target: string, threadId: string): Promise<ProviderCommandCatalog> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before listing its commands");
    const commands: AssistantCommand[] = [];
    const warnings: string[] = [];
    let goal: AssistantGoal | null | undefined;
    try {
      const result = asObject(await session.api.listCollaborationModes());
      const presets = Array.isArray(result?.data) ? result.data : [];
      if (presets.some((preset) => firstString(asObject(preset)?.mode) === "plan")) {
        commands.push({ name: "plan", description: "계획 모드를 켜거나 끕니다.", provider: "Codex", takesArguments: false });
      }
    } catch (error) {
      warnings.push(`Codex 모드 명령을 가져오지 못했습니다: ${errorMessage(error)}`);
    }
    try {
      goal = await readThreadGoal(session.api.getThreadGoal.bind(session.api), threadId);
      commands.push({ name: "goal", description: "현재 목표를 확인하거나 설정·일시 중지·재개·삭제합니다.", provider: "Codex", takesArguments: true });
    } catch {
      // Older Codex app-server versions do not expose the native Goal API.
    }
    return { commands, warnings, ...(goal !== undefined ? { goal } : {}) };
  }

  async runCommand(target: string, threadId: string, command: string, argumentsText: string): Promise<ProviderCommandResult> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before running its commands");
    if (command === "plan") {
      if (argumentsText.trim()) throw new Error("/plan 명령은 인자를 받지 않습니다.");
      const response = asObject(await session.api.listCollaborationModes());
      const presets = (Array.isArray(response?.data) ? response.data : []).map(asObject).filter((preset): preset is Record<string, unknown> => Boolean(preset));
      const current = session.settingsByThread.get(threadId);
      const currentMode = current?.collaborationMode ?? "default";
      const nextMode = currentMode === "plan" ? "default" : "plan";
      const preset = presets.find((item) => item.mode === nextMode) ??
        (nextMode === "default" ? { mode: "default", model: current?.model, reasoning_effort: null } : undefined);
      if (!preset) throw new Error(`Codex에서 ${nextMode === "plan" ? "Plan" : "기본"} 모드를 사용할 수 없습니다.`);
      const model = firstString(preset.model, current?.model) ?? "";
      const effort = typeof preset.reasoning_effort === "string"
        ? preset.reasoning_effort
        : preset.reasoning_effort === null ? null : current?.effort ?? null;
      await session.api.updateThreadSettings(threadId, {
        collaborationMode: { mode: nextMode, settings: { model, reasoning_effort: effort, developer_instructions: null } },
      });
      session.settingsByThread.set(threadId, { model, effort, permissionProfile: current?.permissionProfile ?? null, collaborationMode: nextMode });
      return { executed: true, message: `${nextMode === "plan" ? "Plan" : "기본 실행"} 모드를 사용합니다.` };
    }
    if (command !== "goal") throw new Error(`Codex에서 /${command} 명령을 지원하지 않습니다.`);
    const existingGoal = await readThreadGoal(session.api.getThreadGoal.bind(session.api), threadId);
    const argument = argumentsText.trim();
    if (!argument) {
      return { executed: true, message: existingGoal
        ? `현재 목표 (${existingGoal.status ?? "상태 없음"}): ${existingGoal.objective}`
        : "이 세션에는 설정된 목표가 없습니다. /goal <목표> 형식으로 설정하세요.", goal: existingGoal };
    }
    if (argument === "clear") {
      if (!existingGoal) return { executed: true, message: "삭제할 목표가 없습니다." };
      await session.api.clearThreadGoal(threadId);
      return { executed: true, message: "세션 목표를 삭제했습니다.", goal: null };
    }
    if (argument === "pause" || argument === "resume") {
      if (!existingGoal) throw new Error("일시 중지하거나 재개할 목표가 없습니다.");
      const status = argument === "pause" ? "paused" : "active";
      await session.api.setThreadGoal(threadId, { status });
      return {
        executed: true,
        message: `세션 목표를 ${argument === "pause" ? "일시 중지" : "재개"}했습니다.`,
        goal: await readThreadGoal(session.api.getThreadGoal.bind(session.api), threadId),
      };
    }
    const objective = argument.startsWith("set ") ? argument.slice(4).trim() : argument;
    if (!objective) throw new Error("목표 내용을 입력하세요: /goal <목표>");
    await session.api.setThreadGoal(threadId, { objective });
    return {
      executed: true,
      message: `세션 목표를 설정했습니다: ${objective}`,
      goal: await readThreadGoal(session.api.getThreadGoal.bind(session.api), threadId),
    };
  }
}

async function readThreadGoal(
  getThreadGoal: (threadId: string) => Promise<unknown>,
  threadId: string,
): Promise<AssistantGoal | null> {
  const available = await getThreadGoal(threadId);
  const goal = asObject(asObject(available)?.goal);
  const objective = firstString(goal?.objective);
  if (!objective) return null;
  const status = firstString(goal?.status);
  return { objective, ...(status ? { status } : {}) };
}
