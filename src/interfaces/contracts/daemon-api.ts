import type { AssistantProvider, AssistantProviderInfo } from "../../domain/provider-catalog.js";
import type { AssistantCommand, AssistantModel, AssistantPermissionPreset, AssistantSkill, AssistantThread, PromptImageAttachment } from "../../domain/assistant.js";
import type { WorkspaceFileListing, WorkspaceFileText } from "../../domain/workspace.js";
import type { ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../application/ports/provider-conversations.js";
import type { ProviderForkThreadResult, ProviderSideConversationResult } from "../../application/ports/provider-forks.js";
import type { ProviderCommandResult } from "../../application/ports/provider-commands.js";
import type { ProviderInterruptResult, ProviderPromptResult, ProviderSteerResult } from "../../application/ports/provider-turns.js";
import type { ProviderThreadSettingsResult } from "../../application/ports/provider-settings.js";
import type { ProviderApprovalResult } from "../../application/ports/provider-approvals.js";
import { isAssistantProvider } from "../../domain/provider-catalog.js";

export type { WorkspaceFileItem, WorkspaceFileListing, WorkspaceFileText } from "../../domain/workspace.js";

/** Methods and scopes exposed by the local bridge and remote daemon. */
export const DAEMON_API = {
  listProviders: "catalog",
  connect: "provider",
  refresh: "provider",
  createThread: "provider",
  renameThread: "provider",
  deleteThread: "provider",
  openThread: "provider",
  forkSideThread: "provider",
  forkThread: "provider",
  listSkills: "provider",
  listCommands: "provider",
  runCommand: "provider",
  sendPrompt: "provider",
  steerTurn: "provider",
  interruptTurn: "provider",
  updateThreadSettings: "provider",
  disconnect: "provider",
  answerApproval: "provider",
  terminalStart: "workspace",
  terminalInput: "workspace",
  terminalResize: "workspace",
  terminalStop: "workspace",
  listWorkspaceFiles: "workspace",
  readWorkspaceFile: "workspace",
} as const;

export type DaemonApiMethod = keyof typeof DAEMON_API;
export type DaemonApiScope = (typeof DAEMON_API)[DaemonApiMethod];
export type DaemonApiMethodForScope<Scope extends DaemonApiScope> = {
  [Method in DaemonApiMethod]: (typeof DAEMON_API)[Method] extends Scope ? Method : never;
}[DaemonApiMethod];
export type ProviderDaemonApiMethod = DaemonApiMethodForScope<"provider">;
export type SharedDaemonApiMethod = Exclude<DaemonApiMethod, ProviderDaemonApiMethod>;

type ProviderRequest = { target: string; provider?: AssistantProvider };
type ThreadRequest = ProviderRequest & { threadId: string };

/** Exact request DTOs for every method crossing a daemon/bridge boundary. */
export type DaemonApiRequestMap = {
  listProviders: {};
  connect: ProviderRequest;
  refresh: ProviderRequest;
  createThread: ProviderRequest & { cwd: string; name?: string; permissionPresets?: string[] };
  renameThread: ThreadRequest & { name: string };
  deleteThread: ThreadRequest;
  openThread: ThreadRequest;
  forkSideThread: ThreadRequest;
  forkThread: ThreadRequest & { name: string; turnId?: string; messageId?: string };
  listSkills: ThreadRequest & { cwd?: string };
  listCommands: ThreadRequest & { cwd?: string };
  runCommand: ThreadRequest & { command: string; arguments?: string; cwd?: string };
  sendPrompt: ThreadRequest & { text: string; skillId?: string; cwd?: string; images?: PromptImageAttachment[] };
  steerTurn: ThreadRequest & { turnId: string; text: string; skillId?: string; cwd?: string };
  interruptTurn: ThreadRequest & { turnId: string };
  updateThreadSettings: ThreadRequest & { model?: string; effort?: string; permissionProfile?: string; modeId?: string };
  disconnect: ProviderRequest;
  answerApproval: ProviderRequest & { requestId: number | string; decision: "accept" | "acceptForSession" | "decline" };
  terminalStart: { target: string; cwd: string; sessionId: string; cols: number; rows: number };
  terminalInput: { target: string; sessionId: string; data: string };
  terminalResize: { target: string; sessionId: string; cols: number; rows: number };
  terminalStop: { target: string; sessionId: string };
  listWorkspaceFiles: { target: string; cwd: string; path: string };
  readWorkspaceFile: { target: string; cwd: string; path: string };
};

/** Exact response DTOs for every method crossing a daemon/bridge boundary. */
export type DaemonApiResponseMap = {
  listProviders: { providers: AssistantProviderInfo[] };
  connect: { target: string; threads: AssistantThread[]; models: AssistantModel[]; permissionPresets?: AssistantPermissionPreset[]; modelWarning?: string };
  refresh: { threads: AssistantThread[] };
  createThread: ProviderCreateThreadResult;
  renameThread: { renamed: true };
  deleteThread: { deleted: true };
  openThread: ProviderOpenThreadResult;
  forkSideThread: ProviderSideConversationResult;
  forkThread: ProviderForkThreadResult;
  listSkills: { skills: AssistantSkill[]; warnings: string[] };
  listCommands: { commands: AssistantCommand[]; warnings: string[] };
  runCommand: ProviderCommandResult;
  sendPrompt: ProviderPromptResult;
  steerTurn: ProviderSteerResult;
  interruptTurn: ProviderInterruptResult;
  updateThreadSettings: ProviderThreadSettingsResult;
  disconnect: { disconnected: true };
  answerApproval: ProviderApprovalResult;
  terminalStart: { sessionId: string; started: true };
  terminalInput: { written: true };
  terminalResize: { resized: true };
  terminalStop: { stopped: true };
  listWorkspaceFiles: WorkspaceFileListing;
  readWorkspaceFile: WorkspaceFileText;
};

export type DaemonApiRequest = {
  [Method in DaemonApiMethod]: { method: Method; params: DaemonApiRequestMap[Method] };
}[DaemonApiMethod];
export type DaemonApiResponse = DaemonApiResponseMap[DaemonApiMethod];

const DAEMON_API_METHODS: ReadonlySet<string> = new Set(Object.keys(DAEMON_API));
const PROVIDER_DAEMON_API_METHODS: ReadonlySet<string> = new Set(
  Object.entries(DAEMON_API).filter(([, scope]) => scope === "provider").map(([method]) => method),
);

export function isDaemonApiMethod(method: string): method is DaemonApiMethod {
  return DAEMON_API_METHODS.has(method);
}

export function isProviderDaemonApiMethod(method: string): method is ProviderDaemonApiMethod {
  return PROVIDER_DAEMON_API_METHODS.has(method);
}

type FieldRule = "string" | "number" | "provider" | "string-array" | "images" | "request-id" | "approval-decision";
type OptionalKeys<T extends object> = {
  [Key in keyof T]-?: {} extends Pick<T, Key> ? Key : never;
}[keyof T];
type RequiredKeys<T extends object> = Exclude<keyof T, OptionalKeys<T>>;
type FieldRuleFor<Value> =
  [NonNullable<Value>] extends [PromptImageAttachment[]] ? "images" :
  [NonNullable<Value>] extends [string[]] ? "string-array" :
  [NonNullable<Value>] extends [AssistantProvider] ? "provider" :
  [NonNullable<Value>] extends ["accept" | "acceptForSession" | "decline"] ? "approval-decision" :
  [NonNullable<Value>] extends [number] ? "number" :
  [NonNullable<Value>] extends [string] ? "string" :
  [NonNullable<Value>] extends [string | number] ? "request-id" :
  never;
type RequestShapeFor<Params extends object> = {
  required: { [Key in RequiredKeys<Params>]: FieldRuleFor<Params[Key]> };
  optional: { [Key in OptionalKeys<Params>]-?: FieldRuleFor<Params[Key]> };
};

const REQUEST_SHAPES = {
  listProviders: { required: {}, optional: {} },
  connect: { required: { target: "string" }, optional: { provider: "provider" } },
  refresh: { required: { target: "string" }, optional: { provider: "provider" } },
  createThread: {
    required: { target: "string", cwd: "string" },
    optional: { provider: "provider", name: "string", permissionPresets: "string-array" },
  },
  renameThread: {
    required: { target: "string", threadId: "string", name: "string" },
    optional: { provider: "provider" },
  },
  deleteThread: { required: { target: "string", threadId: "string" }, optional: { provider: "provider" } },
  openThread: { required: { target: "string", threadId: "string" }, optional: { provider: "provider" } },
  forkSideThread: { required: { target: "string", threadId: "string" }, optional: { provider: "provider" } },
  forkThread: {
    required: { target: "string", threadId: "string", name: "string" },
    optional: { provider: "provider", turnId: "string", messageId: "string" },
  },
  listSkills: { required: { target: "string", threadId: "string" }, optional: { provider: "provider", cwd: "string" } },
  listCommands: { required: { target: "string", threadId: "string" }, optional: { provider: "provider", cwd: "string" } },
  runCommand: {
    required: { target: "string", threadId: "string", command: "string" },
    optional: { provider: "provider", arguments: "string", cwd: "string" },
  },
  sendPrompt: {
    required: { target: "string", threadId: "string", text: "string" },
    optional: { provider: "provider", skillId: "string", cwd: "string", images: "images" },
  },
  steerTurn: {
    required: { target: "string", threadId: "string", turnId: "string", text: "string" },
    optional: { provider: "provider", skillId: "string", cwd: "string" },
  },
  interruptTurn: {
    required: { target: "string", threadId: "string", turnId: "string" },
    optional: { provider: "provider" },
  },
  updateThreadSettings: {
    required: { target: "string", threadId: "string" },
    optional: { provider: "provider", model: "string", effort: "string", permissionProfile: "string", modeId: "string" },
  },
  disconnect: { required: { target: "string" }, optional: { provider: "provider" } },
  answerApproval: {
    required: { target: "string", requestId: "request-id", decision: "approval-decision" },
    optional: { provider: "provider" },
  },
  terminalStart: {
    required: { target: "string", cwd: "string", sessionId: "string", cols: "number", rows: "number" },
    optional: {},
  },
  terminalInput: {
    required: { target: "string", sessionId: "string", data: "string" },
    optional: {},
  },
  terminalResize: {
    required: { target: "string", sessionId: "string", cols: "number", rows: "number" },
    optional: {},
  },
  terminalStop: { required: { target: "string", sessionId: "string" }, optional: {} },
  listWorkspaceFiles: { required: { target: "string", cwd: "string", path: "string" }, optional: {} },
  readWorkspaceFile: { required: { target: "string", cwd: "string", path: "string" }, optional: {} },
} as const satisfies { [Method in DaemonApiMethod]: RequestShapeFor<DaemonApiRequestMap[Method]> };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validateField(value: unknown, rule: FieldRule, field: string): void {
  if (rule === "string" && typeof value !== "string") throw new Error(`${field} must be a string`);
  if (rule === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`${field} must be a finite number`);
  if (rule === "provider" && !isAssistantProvider(value)) throw new Error(`${field} is not a supported assistant provider`);
  if (rule === "string-array" && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) throw new Error(`${field} must be a list of strings`);
  if (rule === "request-id" && !((typeof value === "string" && value.length > 0) || (typeof value === "number" && Number.isFinite(value)))) throw new Error(`${field} must be a string or finite number`);
  if (rule === "approval-decision" && value !== "accept" && value !== "acceptForSession" && value !== "decline") throw new Error(`${field} is not a supported approval decision`);
  if (rule === "images") {
    if (!Array.isArray(value) || value.some((item) => {
      const image = asRecord(item);
      if (!image) return true;
      const fields = Object.keys(image);
      return fields.some((field) => field !== "name" && field !== "mimeType" && field !== "data") ||
        !Object.hasOwn(image, "name") || typeof image.name !== "string" ||
        !Object.hasOwn(image, "mimeType") || typeof image.mimeType !== "string" ||
        !Object.hasOwn(image, "data") || typeof image.data !== "string";
    })) throw new Error(`${field} must contain valid image attachments`);
  }
}

/** Validate untrusted JSON at the public daemon API boundary before dispatch. */
export function parseDaemonApiRequest(method: string, value: unknown): DaemonApiRequest {
  if (!isDaemonApiMethod(method)) throw new Error("Unsupported daemon request");
  const params = asRecord(value);
  if (!params) throw new Error("Daemon request params must be an object");
  const shape = REQUEST_SHAPES[method];
  const recognizedFields = new Set([...Object.keys(shape.required), ...Object.keys(shape.optional)]);
  for (const field of Object.keys(params)) {
    if (!recognizedFields.has(field)) throw new Error(`${field} is not supported for ${method}`);
  }
  for (const [field, rule] of Object.entries(shape.required)) {
    if (!Object.hasOwn(params, field)) throw new Error(`${field} is required`);
    validateField(params[field], rule, field);
  }
  for (const [field, rule] of Object.entries(shape.optional)) {
    if (Object.hasOwn(params, field)) validateField(params[field], rule, field);
  }
  // The schema is statically checked against every request DTO above, then validated at runtime.
  return { method, params } as DaemonApiRequest;
}
