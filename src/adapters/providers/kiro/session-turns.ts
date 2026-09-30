import { randomUUID } from "node:crypto";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderTurnsPort, ProviderPromptInput, ProviderPromptResult, ProviderSteerInput, ProviderSteerResult, ProviderInterruptResult } from "../../../application/ports/provider-turns.js";
import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import type { ProviderApprovalsPort, ApprovalDecision, ProviderApprovalResult } from "../../../application/ports/provider-approvals.js";
import { saveKiroSessionPolicyPresets } from "../../persistence/kiro-session-metadata.js";
import { kiroEffortOptions, withKiroEffortOptions } from "./session-catalog-mapper.js";
import { publishKiroEvent } from "./session-events.js";
import { validateKiroPromptImages } from "./prompt-image-validator.js";
import { kiroPermissionPresetsForProfile } from "./session-metadata.js";
import type { KiroRemoteSession, KiroSessionContext } from "./session-context.js";
import type { KiroRequireOpenThread } from "./thread-access.js";
import { asObject, errorMessage, firstString, type JsonObject } from "./session-utils.js";
import { appendA2ACommunicationSummary, hasA2ACommunicationSummary } from "../a2a-prompt-context.js";

/** Implements Kiro prompt, turn, settings, and approval behavior. */
export class KiroSessionTurnAdapter implements ProviderTurnsPort, ProviderSettingsPort, ProviderApprovalsPort {
  constructor(
    private readonly context: KiroSessionContext,
    private readonly requireOpenThread: KiroRequireOpenThread,
    private readonly publish: AssistantEventPublisher,
  ) {}

  async assertPromptReady(target: string, threadId: string): Promise<void> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before sending a message");
    if (!session.settingsByThread.get(threadId)?.model.trim()) {
      throw new Error("Kiro requires a model to be selected before sending a message.");
    }
  }

  async sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before sending a message");
    if (session.activeTurnIds.has(threadId)) throw new Error("Kiro is already working in this session.");
    const promptImages = validateKiroPromptImages(input.images);
    if (!input.text.trim() && !promptImages.length && !hasA2ACommunicationSummary(input.a2aCommunications)) throw new Error("Message cannot be empty");
    let promptText = input.text.trim() || (promptImages.length ? "첨부한 이미지를 확인해 주세요." : "");
    if (input.skillId) {
      const skill = (session.skillsByThread.get(threadId) ?? []).find((candidate) => candidate.id === input.skillId);
      if (!skill) throw new Error("선택한 Kiro 스킬을 찾지 못했습니다. 스킬 목록을 새로고침하세요.");
      promptText = `Use the Kiro skill named "${skill.name}" for this request.\n\n${input.text}`;
    }
    if (promptImages.length) promptText += `\n\n[첨부 이미지: ${promptImages.map((image) => image.name).join(", ")}]`;
    promptText = appendA2ACommunicationSummary(promptText, input.a2aCommunications);
    const turnId = randomUUID();
    const transcript = session.transcriptsByThread.get(threadId) ?? [];
    session.toolFailuresByThread.delete(threadId);
    transcript.push({ id: `kiro-user-${turnId}`, role: "user", text: promptText, turnId });
    session.transcriptsByThread.set(threadId, transcript);
    session.activeTurnIds.set(threadId, turnId);
    publishKiroEvent(this.publish, target, threadId, { type: "turnStarted", turnId });
    const promptContent: JsonObject[] = [
      { type: "text", text: promptText },
      ...promptImages.map((image) => ({ type: "image", mimeType: image.mimeType, data: image.data })),
    ];
    session.connection.startPrompt(threadId, promptContent, (response, rpcError) => {
      if (session.activeTurnIds.get(threadId) !== turnId) return;
      session.activeTurnIds.delete(threadId);
      const toolFailure = session.toolFailuresByThread.get(threadId);
      if (toolFailure?.turnId === turnId) session.toolFailuresByThread.delete(threadId);
      const stopReason = firstString(response?.stopReason, response?.stop_reason);
      const turnError = rpcError
        ? errorMessage(rpcError)
        : toolFailure?.turnId === turnId
          ? toolFailure.message
          : stopReason === "refusal"
            ? "Kiro가 이 요청의 처리를 거부했습니다."
            : stopReason === "max_tokens"
              ? "Kiro가 응답 길이 한도에 도달해 작업을 중단했습니다."
              : stopReason === "max_turn_requests"
                ? "Kiro가 도구 호출 한도에 도달해 작업을 중단했습니다."
                : undefined;
      for (const entry of session.transcriptsByThread.get(threadId) ?? []) {
        if (entry.role === "assistant" && entry.turnId === turnId) {
          entry.responseCompleted = true;
          entry.status = turnError ? "failed" : "completed";
        }
      }
      publishKiroEvent(this.publish, target, threadId, {
        type: "turnCompleted",
        turnId,
        status: turnError ? "failed" : "completed",
        ...(turnError ? { error: turnError } : {}),
      });
    });
    return { accepted: true, turnId };
  }

  async steerTurn(_target: string, _threadId: string, _turnId: string, _input: ProviderSteerInput): Promise<ProviderSteerResult> {
    throw new Error("Kiro ACP does not support adding a message to a running response.");
  }

  async interruptTurn(target: string, threadId: string, turnId: string): Promise<ProviderInterruptResult> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before interrupting its turn");
    const activeTurnId = session.activeTurnIds.get(threadId);
    if (!activeTurnId) {
      publishKiroEvent(this.publish, target, threadId, { type: "turnCompleted", turnId, status: "completed" });
      return { interrupted: true };
    }
    if (activeTurnId !== turnId) throw new Error("Kiro turn is no longer active");
    session.connection.cancel(threadId);
    return { interrupted: true };
  }

  async updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before changing its settings");
    const current = session.settingsByThread.get(threadId) ?? { model: "", effort: null };
    let selectedModel = current.model;
    let selectedEffort = current.effort;
    let supportedReasoningEfforts: ProviderThreadSettingsResult["supportedReasoningEfforts"];
    if (input.permissionProfile !== undefined) {
      const nextPresets = kiroPermissionPresetsForProfile(input.permissionProfile);
      await this.applyKiroPermissionProfile(session, threadId, input.permissionProfile);
      await saveKiroSessionPolicyPresets(target, threadId, nextPresets);
      session.policyPresetsByThread.set(threadId, nextPresets);
      publishKiroEvent(this.publish, target, threadId, {
        type: "threadSettingsUpdated",
        settings: { permissionProfile: input.permissionProfile },
      });
    }
    if (input.model) {
      if (!session.models.some((candidate) => candidate.model === input.model && !candidate.hidden)) throw new Error("The selected model is not in the Kiro model list");
      await session.connection.setModel(threadId, input.model);
      selectedModel = input.model;
      const effortOptions = await kiroEffortOptions(session, threadId);
      selectedEffort = effortOptions.current ?? null;
      supportedReasoningEfforts = effortOptions.options;
      session.models = withKiroEffortOptions(session.models, input.model, effortOptions.options);
    }
    if (input.effort) {
      const options = supportedReasoningEfforts ?? session.models.find((candidate) => candidate.model === selectedModel)?.supportedReasoningEfforts ?? [];
      if (!options.some((candidate) => candidate.reasoningEffort === input.effort)) throw new Error(`${input.effort} is not supported by the selected Kiro model`);
      const result = await session.connection.executeCommand(threadId, "effort", { value: input.effort });
      if (result.success === false) throw new Error(firstString(result.message) ?? `Kiro Thinking 수준을 ${input.effort}(으)로 바꾸지 못했습니다.`);
      selectedEffort = input.effort;
    }
    let selectedModeId = session.currentModeByThread.get(threadId);
    if (input.modeId) {
      if (!session.modesByThread.get(threadId)?.some((candidate) => candidate.id === input.modeId)) throw new Error("The selected Kiro agent mode is not available in this session");
      await session.connection.setMode(threadId, input.modeId);
      selectedModeId = input.modeId;
      session.currentModeByThread.set(threadId, input.modeId);
    }
    if (!input.model && !input.effort && !input.modeId && input.permissionProfile === undefined) throw new Error("Select a Kiro model, Thinking level, permission profile, or agent mode to update");
    session.settingsByThread.set(threadId, { model: selectedModel, effort: selectedEffort });
    return {
      updated: true,
      ...(input.model ? { model: selectedModel } : {}),
      ...(input.effort ? { effort: selectedEffort ?? input.effort } : input.model && selectedEffort ? { effort: selectedEffort } : {}),
      ...(input.permissionProfile !== undefined ? { permissionProfile: input.permissionProfile } : {}),
      ...(input.modeId && selectedModeId ? { currentModeId: selectedModeId } : {}),
      ...(supportedReasoningEfforts ? { supportedReasoningEfforts } : {}),
    };
  }

  private async applyKiroPermissionProfile(
    session: KiroRemoteSession,
    threadId: string,
    profile: string,
  ): Promise<void> {
    const executeToolsCommand = async (value: string): Promise<void> => {
      const result = await session.connection.executeCommand(threadId, "tools", { value });
      if (result.success === false) throw new Error(firstString(result.message) ?? `Kiro 도구 권한을 '${value}'(으)로 변경하지 못했습니다.`);
    };
    await executeToolsCommand("reset");
    if (profile === "allow-all") {
      await executeToolsCommand("trust-all");
    } else if (profile === "read-only") {
      for (const tool of ["read", "grep", "glob"]) await executeToolsCommand(`trust ${tool}`);
    } else if (profile !== "user-choice") {
      throw new Error(`Unknown Kiro permission profile: ${profile}`);
    }
  }

  async answerApproval(target: string, requestId: number | string, decision: ApprovalDecision): Promise<ProviderApprovalResult> {
    const session = this.context.require(target);
    const approvalKey = String(requestId);
    const approval = session.pendingApprovals.get(approvalKey);
    if (!approval) throw new Error("Kiro permission request is no longer active");
    session.pendingApprovals.delete(approvalKey);
    if (decision === "decline") {
      const turnId = session.activeTurnIds.get(approval.threadId);
      if (turnId) {
        session.toolFailuresByThread.set(approval.threadId, {
          turnId,
          message: "Kiro 도구 권한 요청이 거부되어 작업을 중단했습니다.",
        });
      }
      session.connection.respond(requestId, { outcome: "cancelled" });
      return { answered: true };
    }
    const selected = approval.options.find((option) => option.kind === (decision === "acceptForSession" ? "allow_always" : "allow_once")) ??
      approval.options.find((option) => typeof option.optionId === "string" && /allow|accept/i.test(`${option.kind ?? ""} ${option.name ?? ""}`));
    if (!selected || typeof selected.optionId !== "string") throw new Error("Kiro did not offer an approval option for this action");
    session.connection.respond(requestId, { outcome: "selected", optionId: selected.optionId });
    return { answered: true };
  }
}
