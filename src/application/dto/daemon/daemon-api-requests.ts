import type {
  AssistantProvider,
  AssistantProviderCapability,
  AssistantProvidersWithCapability,
  DefaultAssistantProvider,
} from "../../../domain/provider-catalog.js";
import type { AgentContextDto, PromptFileAttachmentDto, PromptImageAttachmentDto } from "../prompt.js";

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
    { threadId: string; text: string; skillId?: string; cwd?: string; images?: PromptImageAttachmentDto[]; files?: PromptFileAttachmentDto[]; agentContext?: AgentContextDto },
    { images: "images"; files: "fileAttachments" }
  >;
  steerTurn: ProviderCapabilityRequest<"turnSteering", { threadId: string; turnId: string; text: string; skillId?: string; cwd?: string; agentContext?: AgentContextDto }>;
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
