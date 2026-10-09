import type { AssistantThreadDto } from "../../dto/assistant.js";
import type { ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../ports/provider-conversations.js";
import type { ProviderForkThreadResult } from "../../ports/provider-forks.js";
import type { ProviderCommandResult } from "../../ports/provider-commands.js";
import type { ProviderInterruptResult, ProviderPromptResult, ProviderSteerResult } from "../../ports/provider-turns.js";
import type { ProviderThreadSettingsResult } from "../../ports/provider-settings.js";
import type { ProviderApprovalResult } from "../../ports/provider-approvals.js";
import type { DaemonApiResponseMap, DaemonOpenThreadResponse } from "../../dto/daemon/daemon-api.js";

type ConversationFields = Omit<DaemonOpenThreadResponse, "target" | "threadId" | "entries">;
type ConversationFieldsSource = Pick<ProviderOpenThreadResult, keyof ConversationFields>;

function conversationFields(result: ConversationFieldsSource): ConversationFields {
  return {
    title: result.title,
    cwd: result.cwd,
    skills: result.skills,
    skillWarnings: result.skillWarnings,
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    permissionProfile: result.permissionProfile,
    ...(result.hiveSessionId !== undefined ? { hiveSessionId: result.hiveSessionId } : {}),
    ...(result.modes !== undefined ? { modes: result.modes } : {}),
    ...(result.currentModeId !== undefined ? { currentModeId: result.currentModeId } : {}),
    ...(result.models !== undefined ? { models: result.models } : {}),
    ...(result.modelWarning !== undefined ? { modelWarning: result.modelWarning } : {}),
  };
}

export function mapCreateThreadResponse(result: ProviderCreateThreadResult): DaemonApiResponseMap["createThread"] {
  return {
    thread: result.thread,
    threadId: result.threadId,
    entries: result.entries,
    ...conversationFields(result),
    ...(result.requiresFocusRestoreAfterDelete !== undefined
      ? { requiresFocusRestoreAfterDelete: result.requiresFocusRestoreAfterDelete }
      : {}),
  };
}

export function mapOpenThreadResponse(result: ProviderOpenThreadResult): DaemonApiResponseMap["openThread"] {
  return {
    target: result.target,
    threadId: result.threadId,
    entries: result.entries,
    ...conversationFields(result),
  };
}

export function mapForkSideThreadResponse(result: Omit<ProviderOpenThreadResult, "entries">): DaemonApiResponseMap["forkSideThread"] {
  return {
    target: result.target,
    threadId: result.threadId,
    ...conversationFields(result),
  };
}

export function mapForkThreadResponse(result: ProviderForkThreadResult): DaemonApiResponseMap["forkThread"] {
  return {
    target: result.target,
    threadId: result.threadId,
    title: result.title,
    cwd: result.cwd,
    preview: result.preview,
    updatedAt: result.updatedAt,
    provider: result.provider,
    ...(result.hiveSessionId !== undefined ? { hiveSessionId: result.hiveSessionId } : {}),
  };
}

export function mapRunCommandResponse(result: ProviderCommandResult): DaemonApiResponseMap["runCommand"] {
  return {
    executed: true,
    ...(result.message !== undefined ? { message: result.message } : {}),
    ...(result.turnId !== undefined ? { turnId: result.turnId } : {}),
    ...(result.thread !== undefined ? { thread: mapThreadResponse(result.thread) } : {}),
    ...(result.goal !== undefined ? { goal: result.goal } : {}),
  };
}

export function mapPromptResponse(result: ProviderPromptResult): DaemonApiResponseMap["sendPrompt"] {
  return { accepted: true, ...(result.turnId !== undefined ? { turnId: result.turnId } : {}) };
}

export function mapSteerResponse(result: ProviderSteerResult): DaemonApiResponseMap["steerTurn"] {
  return { steered: true, ...(result.turnId !== undefined ? { turnId: result.turnId } : {}) };
}

export function mapInterruptResponse(_result: ProviderInterruptResult): DaemonApiResponseMap["interruptTurn"] {
  return { interrupted: true };
}

export function mapThreadSettingsResponse(result: ProviderThreadSettingsResult): DaemonApiResponseMap["updateThreadSettings"] {
  return {
    updated: true,
    ...(result.model !== undefined ? { model: result.model } : {}),
    ...(result.effort !== undefined ? { effort: result.effort } : {}),
    ...(result.permissionProfile !== undefined ? { permissionProfile: result.permissionProfile } : {}),
    ...(result.currentModeId !== undefined ? { currentModeId: result.currentModeId } : {}),
    ...(result.supportedReasoningEfforts !== undefined ? { supportedReasoningEfforts: result.supportedReasoningEfforts } : {}),
  };
}

export function mapApprovalResponse(_result: ProviderApprovalResult): DaemonApiResponseMap["answerApproval"] {
  return { answered: true };
}

function mapThreadResponse(thread: AssistantThreadDto): AssistantThreadDto {
  return {
    id: thread.id,
    provider: thread.provider,
    title: thread.title,
    cwd: thread.cwd,
    preview: thread.preview,
    updatedAt: thread.updatedAt,
    ...(thread.hiveSessionId !== undefined ? { hiveSessionId: thread.hiveSessionId } : {}),
  };
}
