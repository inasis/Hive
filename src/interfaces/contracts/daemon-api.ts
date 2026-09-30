import type {
  AssistantProvider,
  AssistantProviderCapability,
  AssistantProviderInfo,
  AssistantProvidersWithCapability,
  DefaultAssistantProvider,
} from "../../domain/provider-catalog.js";
import type { AssistantCommand, AssistantModel, AssistantPermissionPreset, AssistantSkill, AssistantThread, PromptImageAttachment } from "../../domain/assistant.js";
import type { WorkspaceFileListing, WorkspaceFileText } from "../../domain/workspace.js";
import type { ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../application/ports/provider-conversations.js";
import type { ProviderForkThreadResult, ProviderSideConversationResult } from "../../application/ports/provider-forks.js";
import type { ProviderCommandResult } from "../../application/ports/provider-commands.js";
import type { ProviderInterruptResult, ProviderPromptResult, ProviderSteerResult } from "../../application/ports/provider-turns.js";
import type { ProviderThreadSettingsResult } from "../../application/ports/provider-settings.js";
import type { ProviderApprovalResult } from "../../application/ports/provider-approvals.js";

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
type ProviderCapabilityRequirements<Fields extends object> = Partial<{
  [Key in keyof Fields]: AssistantProviderCapability;
}>;
type ProviderFieldsFor<
  Provider extends AssistantProvider,
  Fields extends object,
  Requirements extends ProviderCapabilityRequirements<Fields>,
> = Omit<Fields, keyof Requirements> & {
  [Key in keyof Requirements]?: [Provider] extends [AssistantProvidersWithCapability<Extract<Requirements[Key], AssistantProviderCapability>>]
    ? Fields[Key & keyof Fields]
    : never;
};
type CapabilityAwareProviderRequest<
  Fields extends object,
  Requirements extends ProviderCapabilityRequirements<Fields>,
> =
  | (ProviderRequest & ProviderFieldsFor<AssistantProvider, Fields, Requirements>)
  | {
      [Provider in AssistantProvider]: Omit<ProviderRequest, "provider"> & { provider: Provider } &
        ProviderFieldsFor<Provider, Fields, Requirements>
    }[AssistantProvider]
  | (Omit<ProviderRequest, "provider"> & { provider?: DefaultAssistantProvider } &
      ProviderFieldsFor<DefaultAssistantProvider, Fields, Requirements>);
type ProviderCapabilityRequest<Capability extends AssistantProviderCapability, Fields extends object> =
  | (Omit<ProviderRequest, "provider"> & { provider: AssistantProvidersWithCapability<Capability> } & Fields)
  | (DefaultAssistantProvider extends AssistantProvidersWithCapability<Capability>
      ? Omit<ProviderRequest, "provider"> & { provider?: DefaultAssistantProvider } & Fields
      : never);

/** Exact request DTOs for every method crossing a daemon/bridge boundary. */
export type DaemonApiRequestMap = {
  listProviders: {};
  connect: ProviderRequest;
  refresh: ProviderRequest;
  createThread: CapabilityAwareProviderRequest<
    { cwd: string; name?: string; permissionPresets?: string[] },
    { name: "createNamedSessions"; permissionPresets: "permissionProfileCreation" }
  >;
  renameThread: ThreadRequest & { name: string };
  deleteThread: ThreadRequest;
  openThread: ThreadRequest & { includeTranscript?: boolean };
  forkSideThread: ThreadRequest;
  forkThread: ThreadRequest & { name: string; turnId?: string; messageId?: string };
  listSkills: ThreadRequest & { cwd?: string };
  listCommands: ThreadRequest & { cwd?: string };
  runCommand: ThreadRequest & { command: string; arguments?: string; cwd?: string };
  sendPrompt: CapabilityAwareProviderRequest<
    { threadId: string; text: string; skillId?: string; cwd?: string; images?: PromptImageAttachment[] },
    { images: "images" }
  >;
  steerTurn: ProviderCapabilityRequest<"turnSteering", { threadId: string; turnId: string; text: string; skillId?: string; cwd?: string }>;
  interruptTurn: ThreadRequest & { turnId: string };
  updateThreadSettings: CapabilityAwareProviderRequest<
    { threadId: string; model?: string; effort?: string; permissionProfile?: string; modeId?: string },
    { effort: "reasoningEffort"; permissionProfile: "permissionProfileUpdates"; modeId: "sessionModes" }
  >;
  disconnect: ProviderRequest;
  answerApproval: ProviderCapabilityRequest<
    "approvals",
    { requestId: number | string; decision: "accept" | "acceptForSession" | "decline" }
  >;
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
