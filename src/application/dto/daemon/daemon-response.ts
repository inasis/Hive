import type { WorkspaceFileListingDto, WorkspaceFileTextDto } from "../workspace.js";
import type { DaemonApiMethod, DaemonApiResponseMap } from "./daemon-api.js";
import {
  asObject,
  hasConversationFields,
  isArrayOf,
  isAssistantProvider,
  isCommand,
  isAssistantGoal,
  isFileItem,
  isFiniteNumber,
  isModel,
  optionalString,
  isPermissionPreset,
  isProviderInfo,
  isReasoningEffort,
  isSkill,
  isString,
  isThread,
  isTranscriptEntry,
} from "./daemon-response-values.js";

type ResponseValidator<Method extends DaemonApiMethod> = (
  value: unknown,
) => value is DaemonApiResponseMap[Method];

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
      optionalString(record, "modelWarning") && optionalString(record, "hostname"));
  },
  refresh: (value): value is DaemonApiResponseMap["refresh"] => {
    const record = asObject(value);
    return Boolean(record && isArrayOf(record.threads, isThread));
  },
  createThread: (value): value is DaemonApiResponseMap["createThread"] => {
    const record = asObject(value);
    return Boolean(record && isThread(record.thread) && isString(record.threadId) &&
      isArrayOf(record.entries, isTranscriptEntry) && hasConversationFields(record, false) &&
      (record.requiresFocusRestoreAfterDelete === undefined || typeof record.requiresFocusRestoreAfterDelete === "boolean"));
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
      isString(record.cwd) && isString(record.preview) && isFiniteNumber(record.updatedAt) && isAssistantProvider(record.provider) &&
      optionalString(record, "hiveSessionId"));
  },
  listSkills: (value): value is DaemonApiResponseMap["listSkills"] => {
    const record = asObject(value);
    return Boolean(record && isArrayOf(record.skills, isSkill) && isArrayOf(record.warnings, isString));
  },
  listCommands: (value): value is DaemonApiResponseMap["listCommands"] => {
    const record = asObject(value);
    return Boolean(record && isArrayOf(record.commands, isCommand) && isArrayOf(record.warnings, isString) &&
      (record.goal === undefined || record.goal === null || isAssistantGoal(record.goal)));
  },
  runCommand: (value): value is DaemonApiResponseMap["runCommand"] => {
    const record = asObject(value);
    return Boolean(record && record.executed === true && optionalString(record, "message") &&
      optionalString(record, "turnId") && (record.thread === undefined || isThread(record.thread)) &&
      (record.goal === undefined || record.goal === null || isAssistantGoal(record.goal)));
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
  listWorkspaceFiles: (value): value is WorkspaceFileListingDto => {
    const record = asObject(value);
    return Boolean(record && isString(record.path) && isArrayOf(record.items, isFileItem));
  },
  readWorkspaceFile: (value): value is WorkspaceFileTextDto => {
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
