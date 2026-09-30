import type {
  AssistantCommand,
  AssistantMode,
  AssistantModel,
  AssistantPermissionPreset,
  AssistantSkill,
  AssistantThread,
  PromptImageAttachment,
  ReasoningEffort,
  TranscriptEntry,
} from "../../domain/assistant.js";
import {
  ASSISTANT_PROVIDER_CAPABILITY_KEYS,
  ASSISTANT_PROVIDERS,
  isAssistantProvider,
  type AssistantProviderInfo,
} from "../../domain/provider-catalog.js";
import type { WorkspaceFileItem, WorkspaceFileListing, WorkspaceFileText } from "../../domain/workspace.js";
import type { DaemonApiMethod, DaemonApiResponseMap } from "./daemon-api.js";

type JsonObject = Record<string, unknown>;
type ResponseValidator<Method extends DaemonApiMethod> = (
  value: unknown,
) => value is DaemonApiResponseMap[Method];

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(record: JsonObject, key: string): boolean {
  return record[key] === undefined || isString(record[key]);
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

function isImageAttachment(value: unknown): value is PromptImageAttachment {
  const record = asObject(value);
  return Boolean(record && isString(record.name) && isString(record.mimeType) && isString(record.data));
}

function isThread(value: unknown): value is AssistantThread {
  const record = asObject(value);
  return Boolean(record && isString(record.id) && isAssistantProvider(record.provider) &&
    isString(record.title) && isString(record.cwd) && isString(record.preview) &&
    (record.updatedAt === null || isString(record.updatedAt) || isFiniteNumber(record.updatedAt)));
}

function isSkill(value: unknown): value is AssistantSkill {
  const record = asObject(value);
  return Boolean(record && isString(record.id) && isString(record.name) && isString(record.description) &&
    isString(record.provider) && isString(record.scope) && typeof record.enabled === "boolean");
}

function isCommand(value: unknown): value is AssistantCommand {
  const record = asObject(value);
  return Boolean(record && isString(record.name) && isString(record.description) &&
    isString(record.provider) && typeof record.takesArguments === "boolean");
}

function isMode(value: unknown): value is AssistantMode {
  const record = asObject(value);
  return Boolean(record && isString(record.id) && isString(record.name) && isString(record.description));
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  const record = asObject(value);
  return Boolean(record && isString(record.reasoningEffort) && isString(record.description));
}

function isModel(value: unknown): value is AssistantModel {
  const record = asObject(value);
  return Boolean(record && isString(record.model) && isString(record.displayName) && isString(record.description) &&
    isString(record.defaultReasoningEffort) && isArrayOf(record.supportedReasoningEfforts, isReasoningEffort) &&
    typeof record.isDefault === "boolean" && typeof record.hidden === "boolean");
}

function isPermissionPreset(value: unknown): value is AssistantPermissionPreset {
  const record = asObject(value);
  return Boolean(record && isString(record.id) && isString(record.label) && isString(record.description));
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  const record = asObject(value);
  if (!record || !isString(record.id) || !isString(record.text) ||
      (record.role !== "user" && record.role !== "assistant" && record.role !== "tool" && record.role !== "change")) return false;
  if (!optionalString(record, "turnId") || !optionalString(record, "providerMessageId") ||
      !optionalString(record, "command") || !optionalString(record, "output") || !optionalString(record, "status")) return false;
  if (record.responseCompleted !== undefined && typeof record.responseCompleted !== "boolean") return false;
  if (record.toolType !== undefined && record.toolType !== "commandExecution" &&
      record.toolType !== "mcpToolCall" && record.toolType !== "webSearch") return false;
  return record.images === undefined || isArrayOf(record.images, isImageAttachment);
}

function isProviderInfo(value: unknown): value is AssistantProviderInfo {
  const record = asObject(value);
  if (!record || !isAssistantProvider(record.id)) return false;
  const canonical = ASSISTANT_PROVIDERS.find((provider) => provider.id === record.id);
  const capabilities = asObject(record.capabilities);
  return Boolean(canonical && isString(record.name) && record.name === canonical.name && capabilities &&
    ASSISTANT_PROVIDER_CAPABILITY_KEYS.every((key) => capabilities[key] === canonical.capabilities[key]));
}

function isFileItem(value: unknown): value is WorkspaceFileItem {
  const record = asObject(value);
  return Boolean(record && isString(record.name) && isString(record.path) &&
    (record.kind === "directory" || record.kind === "file") &&
    (record.size === null || isFiniteNumber(record.size)));
}

function hasConversationFields(record: JsonObject, includeEntries: boolean): boolean {
  return isString(record.title) && isString(record.cwd) && isString(record.model) &&
    (record.reasoningEffort === null || isString(record.reasoningEffort)) &&
    (record.permissionProfile === null || isString(record.permissionProfile)) &&
    isArrayOf(record.skills, isSkill) && isArrayOf(record.skillWarnings, isString) &&
    (!includeEntries || isArrayOf(record.entries, isTranscriptEntry)) &&
    (record.modes === undefined || isArrayOf(record.modes, isMode)) &&
    (record.currentModeId === undefined || record.currentModeId === null || isString(record.currentModeId)) &&
    (record.models === undefined || isArrayOf(record.models, isModel)) &&
    optionalString(record, "modelWarning");
}

const RESPONSE_VALIDATORS: { [Method in DaemonApiMethod]: ResponseValidator<Method> } = {
  listProviders: (value): value is DaemonApiResponseMap["listProviders"] => {
    const record = asObject(value);
    return Boolean(record && isArrayOf(record.providers, isProviderInfo));
  },
  connect: (value): value is DaemonApiResponseMap["connect"] => {
    const record = asObject(value);
    return Boolean(record && isString(record.target) && isArrayOf(record.threads, isThread) &&
      isArrayOf(record.models, isModel) &&
      (record.permissionPresets === undefined || isArrayOf(record.permissionPresets, isPermissionPreset)) &&
      optionalString(record, "modelWarning"));
  },
  refresh: (value): value is DaemonApiResponseMap["refresh"] => {
    const record = asObject(value);
    return Boolean(record && isArrayOf(record.threads, isThread));
  },
  createThread: (value): value is DaemonApiResponseMap["createThread"] => {
    const record = asObject(value);
    return Boolean(record && isThread(record.thread) && isString(record.threadId) &&
      isArrayOf(record.entries, isTranscriptEntry) && hasConversationFields(record, false));
  },
  renameThread: (value): value is DaemonApiResponseMap["renameThread"] => asObject(value)?.renamed === true,
  deleteThread: (value): value is DaemonApiResponseMap["deleteThread"] => asObject(value)?.deleted === true,
  openThread: (value): value is DaemonApiResponseMap["openThread"] => {
    const record = asObject(value);
    return Boolean(record && isString(record.target) && isString(record.threadId) &&
      hasConversationFields(record, true) && isArrayOf(record.entries, isTranscriptEntry));
  },
  forkSideThread: (value): value is DaemonApiResponseMap["forkSideThread"] => {
    const record = asObject(value);
    return Boolean(record && isString(record.target) && isString(record.threadId) && hasConversationFields(record, false));
  },
  forkThread: (value): value is DaemonApiResponseMap["forkThread"] => {
    const record = asObject(value);
    return Boolean(record && isString(record.target) && isString(record.threadId) && isString(record.title) &&
      isString(record.cwd) && isString(record.preview) && isFiniteNumber(record.updatedAt) && isAssistantProvider(record.provider));
  },
  listSkills: (value): value is DaemonApiResponseMap["listSkills"] => {
    const record = asObject(value);
    return Boolean(record && isArrayOf(record.skills, isSkill) && isArrayOf(record.warnings, isString));
  },
  listCommands: (value): value is DaemonApiResponseMap["listCommands"] => {
    const record = asObject(value);
    return Boolean(record && isArrayOf(record.commands, isCommand) && isArrayOf(record.warnings, isString));
  },
  runCommand: (value): value is DaemonApiResponseMap["runCommand"] => {
    const record = asObject(value);
    return Boolean(record && record.executed === true && optionalString(record, "message") &&
      optionalString(record, "turnId") && (record.thread === undefined || isThread(record.thread)));
  },
  sendPrompt: (value): value is DaemonApiResponseMap["sendPrompt"] => {
    const record = asObject(value);
    return Boolean(record && record.accepted === true && optionalString(record, "turnId"));
  },
  steerTurn: (value): value is DaemonApiResponseMap["steerTurn"] => {
    const record = asObject(value);
    return Boolean(record && record.steered === true && optionalString(record, "turnId"));
  },
  interruptTurn: (value): value is DaemonApiResponseMap["interruptTurn"] => asObject(value)?.interrupted === true,
  updateThreadSettings: (value): value is DaemonApiResponseMap["updateThreadSettings"] => {
    const record = asObject(value);
    return Boolean(record && record.updated === true && optionalString(record, "model") &&
      optionalString(record, "effort") && optionalString(record, "permissionProfile") &&
      optionalString(record, "currentModeId") && (record.supportedReasoningEfforts === undefined ||
        isArrayOf(record.supportedReasoningEfforts, isReasoningEffort)));
  },
  disconnect: (value): value is DaemonApiResponseMap["disconnect"] => asObject(value)?.disconnected === true,
  answerApproval: (value): value is DaemonApiResponseMap["answerApproval"] => asObject(value)?.answered === true,
  terminalStart: (value): value is DaemonApiResponseMap["terminalStart"] => {
    const record = asObject(value);
    return Boolean(record && isString(record.sessionId) && record.started === true);
  },
  terminalInput: (value): value is DaemonApiResponseMap["terminalInput"] => asObject(value)?.written === true,
  terminalResize: (value): value is DaemonApiResponseMap["terminalResize"] => asObject(value)?.resized === true,
  terminalStop: (value): value is DaemonApiResponseMap["terminalStop"] => asObject(value)?.stopped === true,
  listWorkspaceFiles: (value): value is WorkspaceFileListing => {
    const record = asObject(value);
    return Boolean(record && isString(record.path) && isArrayOf(record.items, isFileItem));
  },
  readWorkspaceFile: (value): value is WorkspaceFileText => {
    const record = asObject(value);
    return Boolean(record && isString(record.path) && isString(record.content) &&
      isFiniteNumber(record.bytes) && record.bytes >= 0);
  },
};

/** Validate an untrusted daemon response using the request method's exact response contract. */
export function parseDaemonApiResponse<Method extends DaemonApiMethod>(
  method: Method,
  value: unknown,
): DaemonApiResponseMap[Method] {
  if (!RESPONSE_VALIDATORS[method](value)) throw new Error(`Invalid daemon response for ${method}`);
  return value as DaemonApiResponseMap[Method];
}
