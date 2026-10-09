import type { ProviderTurnsPort, ProviderPromptInput, ProviderPromptResult, ProviderSteerInput, ProviderSteerResult, ProviderInterruptResult } from "../../../application/ports/provider-turns.js";
import type { ProviderApprovalsPort, ApprovalDecision, ProviderApprovalResult } from "../../../application/ports/provider-approvals.js";
import { buildOpenCodeSkillInput } from "./prompt.js";
import type { OpenCodeSessionContext } from "./session-context.js";
import type { OpenCodeEventPublisher } from "./types.js";
import { appendA2ACommunicationSummary, hasA2ACommunicationSummary } from "../a2a-prompt-context.js";
import { appendAgentContext } from "../agent-prompt-context.js";

/** Implements OpenCode turn and approval behavior. */
export class OpenCodeTurnAdapter implements ProviderTurnsPort, ProviderApprovalsPort {
  constructor(
    private readonly context: OpenCodeSessionContext,
    private readonly publish: OpenCodeEventPublisher,
  ) {}

  async assertPromptReady(target: string, threadId: string): Promise<void> {
    const session = this.context.require(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before sending a message");
    if (!session.settingsByThread.get(threadId)?.model.trim()) {
      throw new Error("OpenCode requires a model to be selected before sending a message.");
    }
  }

  async sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> {
    if (!input.text.trim() && !hasA2ACommunicationSummary(input.a2aCommunications)) throw new Error("Message cannot be empty");
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
    prompt = appendA2ACommunicationSummary(prompt, input.a2aCommunications);
    prompt = appendAgentContext(prompt, input.agentContext);
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

  async answerApproval(_target: string, _requestId: number | string, _decision: ApprovalDecision): Promise<ProviderApprovalResult> {
    throw new Error("OpenCode approval responses are managed by the OpenCode server.");
  }
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}
