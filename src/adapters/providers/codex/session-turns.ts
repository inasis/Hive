import type { ProviderTurnsPort, ProviderPromptInput, ProviderPromptResult, ProviderSteerInput, ProviderSteerResult, ProviderInterruptResult } from "../../../application/ports/provider-turns.js";
import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import type { ProviderApprovalsPort, ApprovalDecision, ProviderApprovalResult } from "../../../application/ports/provider-approvals.js";
import { discoverCodexSkills } from "./skill-catalog.js";
import { mapCodexSkill } from "./mapper.js";
import { buildCodexPrompt, buildCodexSkillInput } from "./prompt.js";
import type { CodexSessionContext } from "./session-context.js";
import { asObject, firstString } from "./protocol-utils.js";
import { isCodexPermissionPreset } from "./session-metadata.js";

/** Implements Codex prompt, turn, model, reasoning, permission, and approval actions. */
export class CodexSessionTurnAdapter implements ProviderTurnsPort, ProviderSettingsPort, ProviderApprovalsPort {
  constructor(private readonly context: CodexSessionContext) {}

  async sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> {
    if (!input.text.trim()) throw new Error("Message cannot be empty");
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before sending a message");
    let catalog = session.skillsByThread.get(threadId);
    let inputText: string;
    if (input.skillId) {
      catalog = await discoverCodexSkills(session.api, target, firstString(input.cwd));
      session.skillsByThread.set(threadId, catalog);
      const skill = catalog.skills.find((candidate) => mapCodexSkill(candidate).id === input.skillId);
      if (!skill) throw new Error("선택한 스킬을 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.");
      inputText = await buildCodexSkillInput(target, skill, input.text);
    } else {
      inputText = await buildCodexPrompt(target, input.text, catalog);
    }
    const started = asObject(await session.api.startTurn(threadId, inputText));
    const turnId = firstString(asObject(started?.turn)?.id);
    return { accepted: true, ...(turnId ? { turnId } : {}) };
  }

  async steerTurn(target: string, threadId: string, turnId: string, input: ProviderSteerInput): Promise<ProviderSteerResult> {
    if (!input.text.trim()) throw new Error("Message cannot be empty");
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before steering its turn");
    let catalog = session.skillsByThread.get(threadId);
    let inputText: string;
    if (input.skillId) {
      catalog = await discoverCodexSkills(session.api, target, firstString(input.cwd));
      session.skillsByThread.set(threadId, catalog);
      const skill = catalog.skills.find((candidate) => mapCodexSkill(candidate).id === input.skillId);
      if (!skill) throw new Error("선택한 스킬을 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.");
      inputText = await buildCodexSkillInput(target, skill, input.text);
    } else {
      inputText = await buildCodexPrompt(target, input.text, catalog);
    }
    const result = asObject(await session.api.steerTurn(threadId, turnId, inputText));
    const acceptedTurnId = firstString(result?.turnId);
    return { steered: true, ...(acceptedTurnId ? { turnId: acceptedTurnId } : {}) };
  }

  async interruptTurn(target: string, threadId: string, turnId: string): Promise<ProviderInterruptResult> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before interrupting its turn");
    await session.api.interruptTurn(threadId, turnId);
    return { interrupted: true };
  }

  async updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before changing its settings");
    const { model, effort, permissionProfile } = input;
    const current = session.settingsByThread.get(threadId);
    const selectedModel = model ?? current?.model;
    const modelInfo = selectedModel ? session.models.find((candidate) => candidate.model === selectedModel) : undefined;
    if (model && !modelInfo) throw new Error("The selected model is not in the remote Codex model list");
    if (effort && modelInfo && !modelInfo.supportedReasoningEfforts.some((candidate) => candidate.reasoningEffort === effort)) {
      throw new Error(`${effort} is not supported by ${modelInfo.displayName}`);
    }
    if (permissionProfile && !isCodexPermissionPreset(permissionProfile)) {
      throw new Error("The selected permission profile is not supported");
    }
    if (!model && !effort && !permissionProfile) throw new Error("Select a model, Thinking level, or permission profile to update");
    await session.api.updateThreadSettings(threadId, {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(permissionProfile ? {
        permissions: permissionProfile,
        approvalPolicy: permissionProfile === ":danger-full-access" ? "never" : "on-request",
      } : {}),
    });
    session.settingsByThread.set(threadId, {
      model: selectedModel ?? "",
      effort: effort ?? current?.effort ?? null,
      permissionProfile: permissionProfile ?? current?.permissionProfile ?? null,
      collaborationMode: current?.collaborationMode ?? "default",
    });
    return { updated: true, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(permissionProfile ? { permissionProfile } : {}) };
  }

  async answerApproval(target: string, requestId: number | string, decision: ApprovalDecision): Promise<ProviderApprovalResult> {
    const session = this.context.get(target);
    if (!session) throw new Error("Codex connection is no longer active");
    session.api.respondToRequest(requestId, { decision });
    return { answered: true };
  }
}
