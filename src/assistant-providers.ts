export const ASSISTANT_PROVIDERS = [
  {
    id: "codex",
    name: "Codex",
    capabilities: {
      models: true,
      reasoningEffort: true,
      permissionProfiles: true,
      turnSteering: true,
      approvals: true,
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    capabilities: {
      models: true,
      reasoningEffort: false,
      permissionProfiles: false,
      turnSteering: false,
      approvals: false,
    },
  },
  {
    id: "kiro",
    name: "Kiro",
    capabilities: {
      models: true,
      reasoningEffort: true,
      permissionProfiles: true,
      turnSteering: false,
      approvals: true,
      renameSessions: true,
      forks: true,
      sessionModes: true,
      skills: true,
      slashCommands: true,
      images: true,
      workspaceFiles: true,
      terminal: true,
    },
  },
] as const;

export const DEFAULT_ASSISTANT_PROVIDER = ASSISTANT_PROVIDERS[0].id;

export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number]["id"];
export type AssistantProviderInfo = (typeof ASSISTANT_PROVIDERS)[number];

export function isAssistantProvider(value: unknown): value is AssistantProvider {
  return typeof value === "string" && ASSISTANT_PROVIDERS.some((provider) => provider.id === value);
}
