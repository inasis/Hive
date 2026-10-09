export type AssistantProviderCapabilities = {
  models: boolean;
  requiresModelBeforePrompt: boolean;
  reasoningEffort: boolean;
  permissionProfileCreation: boolean;
  permissionProfileUpdates: boolean;
  turnSteering: boolean;
  approvals: boolean;
  createNamedSessions: boolean;
  renameSessions: boolean;
  forks: boolean;
  persistentSideChats: boolean;
  sessionModes: boolean;
  skills: boolean;
  slashCommands: boolean;
  images: boolean;
  fileAttachments: boolean;
  /** Provider protocol can request file operations from Hive's workspace adapter. */
  workspaceFileRequests: boolean;
  /** Provider protocol can request terminal operations from Hive's terminal adapter. */
  terminalRequests: boolean;
};

const providers = [
  {
    id: "codex",
    name: "Codex",
    capabilities: {
      models: true,
      requiresModelBeforePrompt: false,
      reasoningEffort: true,
      permissionProfileCreation: false,
      permissionProfileUpdates: true,
      turnSteering: true,
      approvals: true,
      createNamedSessions: false,
      renameSessions: true,
      forks: true,
      persistentSideChats: false,
      sessionModes: true,
      skills: true,
      slashCommands: true,
      images: true,
      fileAttachments: true,
      workspaceFileRequests: false,
      terminalRequests: false,
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    capabilities: {
      models: true,
      requiresModelBeforePrompt: true,
      reasoningEffort: false,
      permissionProfileCreation: false,
      permissionProfileUpdates: false,
      turnSteering: false,
      approvals: false,
      createNamedSessions: false,
      renameSessions: true,
      forks: true,
      persistentSideChats: false,
      sessionModes: false,
      skills: true,
      slashCommands: true,
      images: false,
      fileAttachments: false,
      workspaceFileRequests: false,
      terminalRequests: false,
    },
  },
  {
    id: "pi",
    name: "Pi",
    capabilities: {
      models: true,
      requiresModelBeforePrompt: true,
      reasoningEffort: true,
      permissionProfileCreation: false,
      permissionProfileUpdates: false,
      turnSteering: true,
      approvals: false,
      createNamedSessions: true,
      renameSessions: true,
      forks: true,
      persistentSideChats: false,
      sessionModes: false,
      skills: true,
      slashCommands: true,
      images: true,
      fileAttachments: false,
      workspaceFileRequests: false,
      terminalRequests: false,
    },
  },
  {
    id: "kiro",
    name: "Kiro",
    capabilities: {
      models: true,
      requiresModelBeforePrompt: true,
      reasoningEffort: true,
      permissionProfileCreation: true,
      permissionProfileUpdates: true,
      turnSteering: false,
      approvals: true,
      createNamedSessions: true,
      renameSessions: true,
      forks: true,
      persistentSideChats: true,
      sessionModes: true,
      skills: true,
      slashCommands: true,
      images: true,
      fileAttachments: false,
      workspaceFileRequests: true,
      terminalRequests: true,
    },
  },
] as const satisfies readonly {
  id: string;
  name: string;
  capabilities: AssistantProviderCapabilities;
}[];

export const ASSISTANT_PROVIDERS = providers;

export const DEFAULT_ASSISTANT_PROVIDER = ASSISTANT_PROVIDERS[0].id;

export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number]["id"];
export type AssistantProviderInfo = (typeof ASSISTANT_PROVIDERS)[number];
export type AssistantProviderCapability = keyof AssistantProviderCapabilities;
export type DefaultAssistantProvider = typeof DEFAULT_ASSISTANT_PROVIDER;
export type AssistantProvidersWithCapability<Capability extends AssistantProviderCapability> =
  Extract<AssistantProviderInfo, { capabilities: Record<Capability, true> }>["id"];
export const ASSISTANT_PROVIDER_CAPABILITY_KEYS: readonly AssistantProviderCapability[] = Object.freeze(
  Object.keys(ASSISTANT_PROVIDERS[0].capabilities) as AssistantProviderCapability[],
);

export function isAssistantProvider(value: unknown): value is AssistantProvider {
  return typeof value === "string" && ASSISTANT_PROVIDERS.some((provider) => provider.id === value);
}

export function assistantProviderSupports<Capability extends AssistantProviderCapability>(
  provider: AssistantProvider,
  capability: Capability,
): provider is AssistantProvidersWithCapability<Capability>;
export function assistantProviderSupports(
  provider: AssistantProvider,
  capability: AssistantProviderCapability,
): boolean {
  return ASSISTANT_PROVIDERS.find((item) => item.id === provider)?.capabilities[capability] === true;
}
