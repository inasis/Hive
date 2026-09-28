import type { ProviderTurnsPort, ProviderPromptInput, ProviderPromptResult, ProviderSteerInput, ProviderSteerResult, ProviderInterruptResult } from "../../../application/ports/provider-turns.js";
import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import type { ProviderApprovalsPort, ApprovalDecision, ProviderApprovalResult } from "../../../application/ports/provider-approvals.js";
import { buildOpenCodeSkillInput } from "./prompt.js";
import type { OpenCodeSessionContext } from "./session-context.js";
import type { OpenCodeEventPublisher } from "./types.js";

/** Implements OpenCode turn, model-selection, and approval behavior. */
export class OpenCodeTurnAdapter implements ProviderTurnsPort, ProviderSettingsPort, ProviderApprovalsPort {
  constructor(
    private readonly context: OpenCodeSessionContext,
    private readonly publish: OpenCodeEventPublisher,
  ) {}

  async sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> {
    if (!input.text.trim()) throw new Error("Message cannot be empty");
    const session = this.context.require(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before sending a message");
    let prompt = input.text;
    if (input.skillId) {
      const directory = firstString(input.cwd, session.cwdByThread.get(threadId));
      const catalog = await this.context.loadSkills(session, threadId, directory);
      const skill = catalog.skills.find((candidate) => candidate.id === input.skillId);
      if (!skill) throw new Error("선택한 OpenCode 스킬을 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.");
      prompt = buildOpenCodeSkillInput(skill, input.text);
    }
    const turnId = await session.connection.sendPrompt(
      target,
      threadId,
      prompt,
      session.settingsByThread.get(threadId)?.model ?? "",
      this.publish,
    );
    return { accepted: true, turnId };
  }

  async steerTurn(_target: string, _threadId: string, _turnId: string, _input: ProviderSteerInput): Promise<ProviderSteerResult> {
    throw new Error("OpenCode는 생성 중인 응답에 메시지를 끼워 넣을 수 없습니다. 현재 응답을 중지한 뒤 다시 보내세요.");
  }

  async interruptTurn(target: string, threadId: string, _turnId: string): Promise<ProviderInterruptResult> {
    await this.context.require(target).connection.abortSession(target, threadId, this.publish);
    return { interrupted: true };
  }

  async updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    if (input.effort || input.permissionProfile) throw new Error("OpenCode does not expose Codex Thinking or permission profile settings.");
    const session = this.context.require(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before changing its settings");
    if (!input.model) throw new Error("Select an OpenCode model to update");
    const availableModels = session.modelsByThread.get(threadId) ?? session.connection.models;
    if (!availableModels.some((candidate) => candidate.model === input.model && !candidate.hidden)) {
      throw new Error("The selected model is not in the OpenCode model list for this workspace");
    }
    await session.connection.setSessionModel(threadId, input.model);
    session.settingsByThread.set(threadId, { model: input.model });
    return { updated: true, model: input.model };
  }

  async answerApproval(_target: string, _requestId: number | string, _decision: ApprovalDecision): Promise<ProviderApprovalResult> {
    throw new Error("OpenCode approval responses are managed by the OpenCode server.");
  }
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}
