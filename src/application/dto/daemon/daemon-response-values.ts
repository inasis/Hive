import type {
  AssistantCommandDto,
  AssistantGoalDto,
  AssistantModeDto,
  AssistantModelDto,
  AssistantPermissionPresetDto,
  AssistantProviderInfoDto,
  AssistantSkillDto,
  AssistantThreadDto,
  ReasoningEffortDto,
} from "../assistant.js";
import type { A2ACommunicationSummaryItemDto } from "../a2a-communication.js";
import type { TranscriptEntryDto, TranscriptPromptImageDto } from "../transcript-cache.js";
import type { WorkspaceFileItemDto } from "../workspace.js";
import {
  ASSISTANT_PROVIDER_CAPABILITY_KEYS,
  ASSISTANT_PROVIDERS,
  isAssistantProvider,
} from "../../../domain/provider-catalog.js";

export { isAssistantProvider };

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function optionalString(record: JsonObject, key: string): boolean {
  return record[key] === undefined || isString(record[key]);
}

export function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

export function isImageAttachment(value: unknown): value is TranscriptPromptImageDto {
  const record = asObject(value);
  return Boolean(record && isString(record.name) && isString(record.mimeType) && isString(record.data));
}

export function isA2ACommunicationSummaryItem(value: unknown): value is A2ACommunicationSummaryItemDto {
  const record = asObject(value);
  return Boolean(record && (record.kind === "request" || record.kind === "result") &&
    isString(record.taskId) && isString(record.sourceAgentId) && isString(record.message) &&
    optionalString(record, "sourceSessionName") &&
    (record.createdAt === undefined || isFiniteNumber(record.createdAt)));
}

export function isThread(value: unknown): value is AssistantThreadDto {
  const record = asObject(value);
  return Boolean(record && isString(record.id) && isAssistantProvider(record.provider) &&
    isString(record.title) && isString(record.cwd) && isString(record.preview) &&
    (record.updatedAt === null || isString(record.updatedAt) || isFiniteNumber(record.updatedAt)) &&
    optionalString(record, "hiveSessionId"));
}

export function isSkill(value: unknown): value is AssistantSkillDto {
  const record = asObject(value);
  return Boolean(record && isString(record.id) && isString(record.name) && isString(record.description) &&
    isString(record.provider) && isString(record.scope) && typeof record.enabled === "boolean");
}

export function isCommand(value: unknown): value is AssistantCommandDto {
  const record = asObject(value);
  return Boolean(record && isString(record.name) && isString(record.description) &&
    isString(record.provider) && typeof record.takesArguments === "boolean");
}

export function isAssistantGoal(value: unknown): value is AssistantGoalDto {
  const record = asObject(value);
  return Boolean(record && isString(record.objective) && record.objective.trim() && optionalString(record, "status"));
}

export function isMode(value: unknown): value is AssistantModeDto {
  const record = asObject(value);
  return Boolean(record && isString(record.id) && isString(record.name) && isString(record.description));
}

export function isReasoningEffort(value: unknown): value is ReasoningEffortDto {
  const record = asObject(value);
  return Boolean(record && isString(record.reasoningEffort) && isString(record.description));
}

export function isModel(value: unknown): value is AssistantModelDto {
  const record = asObject(value);
  return Boolean(record && isString(record.model) && isString(record.displayName) && isString(record.description) &&
    isString(record.defaultReasoningEffort) && isArrayOf(record.supportedReasoningEfforts, isReasoningEffort) &&
    typeof record.isDefault === "boolean" && typeof record.hidden === "boolean");
}

export function isPermissionPreset(value: unknown): value is AssistantPermissionPresetDto {
  const record = asObject(value);
  return Boolean(record && isString(record.id) && isString(record.label) && isString(record.description));
}

export function isTranscriptEntry(value: unknown): value is TranscriptEntryDto {
  const record = asObject(value);
  if (!record || !isString(record.id) || !isString(record.text) ||
      (record.role !== "user" && record.role !== "assistant" && record.role !== "tool" &&
       record.role !== "change" && record.role !== "communication")) return false;
  if (!optionalString(record, "turnId") || !optionalString(record, "providerMessageId") ||
      !optionalString(record, "command") || !optionalString(record, "output") || !optionalString(record, "status")) return false;
  if (record.createdAt !== undefined && !isFiniteNumber(record.createdAt)) return false;
  if (record.responseDurationMs !== undefined &&
      (!isFiniteNumber(record.responseDurationMs) || record.responseDurationMs < 0)) return false;
  if (record.responseCompleted !== undefined && typeof record.responseCompleted !== "boolean") return false;
  if (record.toolType !== undefined && record.toolType !== "commandExecution" &&
      record.toolType !== "mcpToolCall" && record.toolType !== "webSearch") return false;
  if (record.communications !== undefined && !isArrayOf(record.communications, isA2ACommunicationSummaryItem)) return false;
  if (record.role === "communication" &&
      (!Array.isArray(record.communications) || record.communications.length === 0 ||
       !record.communications.every(isA2ACommunicationSummaryItem))) return false;
  return record.images === undefined || isArrayOf(record.images, isImageAttachment);
}

export function isProviderInfo(value: unknown): value is AssistantProviderInfoDto {
  const record = asObject(value);
  if (!record || !isAssistantProvider(record.id)) return false;
  const canonical = ASSISTANT_PROVIDERS.find((provider) => provider.id === record.id);
  const capabilities = asObject(record.capabilities);
  return Boolean(canonical && isString(record.name) && record.name === canonical.name && capabilities &&
    ASSISTANT_PROVIDER_CAPABILITY_KEYS.every((key) => capabilities[key] === canonical.capabilities[key]));
}

export function isFileItem(value: unknown): value is WorkspaceFileItemDto {
  const record = asObject(value);
  return Boolean(record && isString(record.name) && isString(record.path) &&
    (record.kind === "directory" || record.kind === "file") &&
    (record.size === null || isFiniteNumber(record.size)));
}

export function hasConversationFields(record: JsonObject, includeEntries: boolean): boolean {
  return isString(record.title) && isString(record.cwd) && isString(record.model) &&
    (record.reasoningEffort === null || isString(record.reasoningEffort)) &&
    (record.permissionProfile === null || isString(record.permissionProfile)) &&
    isArrayOf(record.skills, isSkill) && isArrayOf(record.skillWarnings, isString) &&
    (!includeEntries || isArrayOf(record.entries, isTranscriptEntry)) &&
    (record.modes === undefined || isArrayOf(record.modes, isMode)) &&
    (record.currentModeId === undefined || record.currentModeId === null || isString(record.currentModeId)) &&
    (record.models === undefined || isArrayOf(record.models, isModel)) &&
    optionalString(record, "modelWarning") && optionalString(record, "hiveSessionId");
}
