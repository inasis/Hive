import type { AssistantEvent, AssistantEventPublisher } from "../application/ports/events.js";
import type { TerminalEventSink } from "../application/ports/terminal.js";
import type { CodexCliEvent } from "../application/ports/codex-cli.js";
import type { AssistantProvider } from "../domain/provider-catalog.js";
import { LOCAL_WORKSPACE_TARGET } from "../domain/workspace.js";
import type { AgentAdapter } from "../application/ports/a2a-runtime.js";
import { CodexSessionManager } from "../adapters/providers/codex/session-manager.js";
import { handleCodexNotification } from "../adapters/providers/codex/notifications.js";
import { OpenCodeSessionManager } from "../adapters/providers/opencode/session-manager.js";
import { KiroSessionManager } from "../adapters/providers/kiro/session-manager.js";
import { handleKiroNotification } from "../adapters/providers/kiro/session-notifications.js";
import { createKiroServerRequestHandler } from "../adapters/providers/kiro/server-requests.js";
import { PtyTerminalAdapter } from "../adapters/terminal/pty-manager.js";
import { RoutedWorkspaceFileAdapter } from "../adapters/workspace/files.js";
import { ProviderApprovalUseCases } from "../application/use-cases/provider-approvals.js";
import { ProviderCatalogUseCases } from "../application/use-cases/provider-catalog.js";
import { ProviderDisconnectUseCases } from "../application/use-cases/provider-disconnect.js";
import { ProviderCommandUseCases } from "../application/use-cases/provider-commands.js";
import { ProviderConversationUseCases } from "../application/use-cases/provider-conversations.js";
import { ProviderForkUseCases } from "../application/use-cases/provider-forks.js";
import { ProviderSessionUseCases } from "../application/use-cases/provider-sessions.js";
import { ProviderSettingsUseCases } from "../application/use-cases/provider-settings.js";
import { ProviderSkillUseCases } from "../application/use-cases/provider-skills.js";
import { ProviderTurnUseCases } from "../application/use-cases/provider-turns.js";
import { TerminalUseCases } from "../application/use-cases/terminal.js";
import { WorkspaceFileUseCases } from "../application/use-cases/workspace-files.js";
import { decodeHiveSessionAddress, HiveSessionAgentAdapter } from "../adapters/providers/hive-session-agent.js";
import { ManualConfigurationAgentAdapter } from "../adapters/providers/manual-agent.js";
import { createKiroA2AMcpServers } from "../adapters/providers/kiro/a2a-mcp-server.js";
import { isCodexPermissionPreset } from "../adapters/providers/codex/session-metadata.js";
import { isKiroPermissionProfile } from "../adapters/providers/kiro/session-metadata.js";
import { loadA2ACliProfiles } from "../adapters/persistence/a2a-cli-profiles.js";
import { parseHiveRelayTarget } from "../adapters/transport/relay-target.js";
import { createA2ARuntime } from "./a2a-runtime.js";

export type AssistantRuntimeOptions = {
  /** Existing Hive provider targets allowed to participate in A2A discovery. */
  a2aTargets?: Partial<Record<AssistantProvider, readonly string[]>>;
  /** Optional private JSON state file for A2A rooms, tasks, and session mappings. */
  a2aStateFilePath?: string;
  /** Optional declarative profile file for external CLI and custom agents. */
  a2aCliProfilesFilePath?: string;
  /** Additional explicit CLI/API/PTY adapters supplied by the host. */
  a2aAdapters?: readonly AgentAdapter[];
};

/** Build the provider and infrastructure adapters shared by daemon and CLI composition roots. */
export function createAssistantRuntime(
  publishEvent: AssistantEventPublisher,
  publishTerminalEvent: TerminalEventSink,
  publishCodexCliEvent?: (event: CodexCliEvent) => void,
  options: AssistantRuntimeOptions = {},
) {
  const internalEventListeners = new Set<(event: AssistantEvent) => void>();
  const emitAssistantEvent: AssistantEventPublisher = (event) => {
    publishEvent(event);
    for (const listener of internalEventListeners) listener(event);
  };
  const codexProvider = new CodexSessionManager((target, session, method, params, requestId) =>
    handleCodexNotification(emitAssistantEvent, target, session, method, params, requestId), publishCodexCliEvent);
  const openCodeProvider = new OpenCodeSessionManager((event) => emitAssistantEvent({ ...event, provider: "opencode" }));
  const workspaceFiles = new RoutedWorkspaceFileAdapter();
  const terminalAdapter = new PtyTerminalAdapter(publishTerminalEvent);
  const terminal = new TerminalUseCases(terminalAdapter);
  const kiroServerRequestHandler = createKiroServerRequestHandler(workspaceFiles, emitAssistantEvent);
  const kiroProvider = new KiroSessionManager(
    kiroServerRequestHandler,
    (session, target, notification) => handleKiroNotification(session, target, notification, emitAssistantEvent),
    emitAssistantEvent,
  );
  const providers = { codex: codexProvider, opencode: openCodeProvider, kiro: kiroProvider };
  const configuredTargets = options.a2aTargets ?? configuredA2ATargetsFromEnvironment();
  const cliProfilePath = options.a2aCliProfilesFilePath ?? process.env.HIVE_A2A_CLI_PROFILES_FILE?.trim();
  const configuredCliAdapters = cliProfilePath ? loadA2ACliProfiles(cliProfilePath) : [];
  const externallyConfiguredProviders = new Set([
    ...configuredCliAdapters.map((adapter) => adapter.provider),
    ...(options.a2aAdapters ?? []).map((adapter) => adapter.provider),
  ]);
  const manualAdapters = ["claude", "pi", "antigravity", "custom"]
    .filter((provider) => !externallyConfiguredProviders.has(provider))
    .map((provider) => new ManualConfigurationAgentAdapter(`${provider}-manual-profile-required`, provider));
  const subscribeAssistantEvents = (handler: (event: AssistantEvent) => void): (() => void) => {
    internalEventListeners.add(handler);
    return () => internalEventListeners.delete(handler);
  };
  const a2aStateFilePath = options.a2aStateFilePath ?? process.env.HIVE_A2A_STATE_FILE?.trim();
  const a2aRuntime = createA2ARuntime({
    adapters: [
      new HiveSessionAgentAdapter({
        adapterId: "hive-codex-session",
        provider: "codex",
        targets: configuredTargets.codex ?? [],
        catalog: codexProvider,
        conversations: codexProvider,
        sessions: codexProvider,
        settings: codexProvider,
        isPermissionProfileSupported: isCodexPermissionPreset,
        turns: codexProvider,
        subscribe: subscribeAssistantEvents,
        publishEvent: emitAssistantEvent,
        delegationAvailable: a2aHttpToolProvisionEnabled(),
        canDelegateSession: (session) => codexA2AToolConfigured(session.sessionId),
      }),
      new HiveSessionAgentAdapter({
        adapterId: "hive-opencode-session",
        provider: "opencode",
        targets: configuredTargets.opencode ?? [],
        catalog: openCodeProvider,
        conversations: openCodeProvider,
        sessions: openCodeProvider,
        settings: openCodeProvider,
        permissionHandling: "preserve-target",
        turns: openCodeProvider,
        subscribe: subscribeAssistantEvents,
        publishEvent: emitAssistantEvent,
        delegationAvailable: a2aHttpToolProvisionEnabled() && !process.env.HIVE_OPENCODE_URL?.trim(),
        canDelegateSession: () => a2aHttpToolProvisionEnabled() && Boolean(process.env.HIVE_A2A_MCP_URL?.trim() && process.env.HIVE_A2A_HTTP_TOKEN?.trim()) && !process.env.HIVE_OPENCODE_URL?.trim(),
      }),
      new HiveSessionAgentAdapter({
        adapterId: "hive-kiro-session",
        provider: "kiro",
        targets: configuredTargets.kiro ?? [],
        catalog: kiroProvider,
        conversations: kiroProvider,
        sessions: kiroProvider,
        settings: kiroProvider,
        isPermissionProfileSupported: isKiroPermissionProfile,
        turns: kiroProvider,
        subscribe: subscribeAssistantEvents,
        publishEvent: emitAssistantEvent,
        delegationAvailable: a2aHttpToolProvisionEnabled(),
        canDelegateSession: (session) => {
          const address = decodeHiveSessionAddress(session.sessionId);
          return Boolean(address && createKiroA2AMcpServers(address.target).length);
        },
      }),
      ...manualAdapters,
      ...configuredCliAdapters,
      ...(options.a2aAdapters ?? []),
    ],
    ...(a2aStateFilePath ? { stateFilePath: a2aStateFilePath } : {}),
    publishAssistantEvent: emitAssistantEvent,
  });
  const a2aReady = a2aRuntime.initialize();
  void a2aReady.catch(() => undefined);
  const providerTurns = new ProviderTurnUseCases(providers, emitAssistantEvent);
  const useCases = {
    providerCatalog: new ProviderCatalogUseCases(providers),
    providerSessions: new ProviderSessionUseCases(providers),
    providerConversations: new ProviderConversationUseCases(providers),
    providerForks: new ProviderForkUseCases(providers),
    providerSkills: new ProviderSkillUseCases(providers),
    providerCommands: new ProviderCommandUseCases(providers),
    providerTurns,
    providerSettings: new ProviderSettingsUseCases(providers),
    providerApprovals: new ProviderApprovalUseCases(providers),
    providerDisconnect: new ProviderDisconnectUseCases(providers, terminalAdapter),
    terminal,
    workspaceFiles: new WorkspaceFileUseCases(workspaceFiles),
    a2a: a2aRuntime,
  };

  return {
    codexProvider,
    openCodeProvider,
    kiroProvider,
    providers,
    useCases,
    a2aRuntime,
    a2aReady,
    warmOpenCodeProvider: () => openCodeProvider.warmLocal(),
    stopOpenCodeProvider: () => openCodeProvider.closeAll(),
    terminateKiro: () => kiroProvider.terminateAll(),
  };
}

function a2aHttpToolProvisionEnabled(): boolean {
  return process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() !== "false";
}

function codexA2AToolConfigured(sessionId: string): boolean {
  const address = decodeHiveSessionAddress(sessionId);
  const endpoint = process.env.HIVE_A2A_MCP_URL?.trim();
  const token = process.env.HIVE_A2A_HTTP_TOKEN?.trim();
  if (!address || !endpoint || !token || !a2aHttpToolProvisionEnabled()) return false;
  if (address.target === LOCAL_WORKSPACE_TARGET) return true;
  if (parseHiveRelayTarget(address.target)) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function configuredA2ATargetsFromEnvironment(): Partial<Record<AssistantProvider, readonly string[]>> {
  const targetNames = {
    codex: "HIVE_A2A_CODEX_TARGETS",
    opencode: "HIVE_A2A_OPENCODE_TARGETS",
    kiro: "HIVE_A2A_KIRO_TARGETS",
  } as const;
  const targets: Partial<Record<AssistantProvider, readonly string[]>> = {
    codex: [LOCAL_WORKSPACE_TARGET],
    opencode: [LOCAL_WORKSPACE_TARGET],
    kiro: [LOCAL_WORKSPACE_TARGET],
  };
  for (const [provider, environmentName] of Object.entries(targetNames) as Array<[AssistantProvider, string]>) {
    const raw = process.env[environmentName]?.trim();
    if (!raw) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`${environmentName} must be a JSON array of provider targets`);
    }
    if (!Array.isArray(value) || value.some((target) => typeof target !== "string" || !target.trim())) {
      throw new Error(`${environmentName} must be a JSON array of non-empty provider targets`);
    }
    targets[provider] = [...new Set(value.map((target: string) => target.trim()))];
  }
  return targets;
}
