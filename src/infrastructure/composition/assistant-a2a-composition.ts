import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantEvent, AssistantEventPublisher } from "../../application/ports/events.js";
import type { AgentAdapter } from "../../application/ports/a2a-agent-adapter.js";
import type { AssistantProviderPorts } from "./assistant-provider-ports.js";
import { configuredA2ATargetsFromEnvironment, isA2AHttpToolProvisionEnabled, isCodexA2AToolConfigured, isOpenCodeA2AToolConfigured, isOpenCodeA2AToolProvisionAvailable } from "../providers/a2a-delegation-configuration.js";
import { piA2AToolsConfigured } from "../providers/pi/a2a-tools.js";
import { HiveSessionAgentAdapter } from "../providers/hive-session-agent.js";
import { decodeHiveSessionAddress } from "../providers/hive-session-agent-address.js";
import { ManualConfigurationAgentAdapter } from "../providers/manual-agent.js";
import { createKiroA2AMcpServers } from "../providers/kiro/a2a-mcp-server.js";
import { isCodexPermissionPreset } from "../providers/codex/session-metadata.js";
import { isKiroPermissionProfile } from "../providers/kiro/session-metadata.js";
import { loadA2ACliProfiles } from "../persistence/a2a-cli-profiles.js";
import { FileSessionIdentityStore } from "../persistence/session-identity-store.js";
import { createA2ARuntime } from "./a2a-runtime.js";
import type { AssistantRuntimeOptions } from "./assistant-runtime-options.js";

export type AssistantA2AComposition = {
  sessionIdentities: FileSessionIdentityStore;
  a2aRuntime: ReturnType<typeof createA2ARuntime>;
  a2aReady: Promise<void>;
};

/** Wires the configured provider-session and external adapters into the shared A2A runtime. */
export function composeAssistantA2A(
  providers: Pick<AssistantProviderPorts, "catalogs" | "sessions" | "conversations" | "settings" | "turns">,
  publishAssistantEvent: AssistantEventPublisher,
  subscribeAssistantEvents: (handler: (event: AssistantEvent) => void) => () => void,
  options: AssistantRuntimeOptions,
): AssistantA2AComposition {
  const configuredTargets = options.a2aTargets ?? configuredA2ATargetsFromEnvironment();
  const cliProfilePath = options.a2aCliProfilesFilePath ?? process.env.HIVE_A2A_CLI_PROFILES_FILE?.trim();
  const configuredCliAdapters = cliProfilePath ? loadA2ACliProfiles(cliProfilePath) : [];
  const externallyConfiguredProviders = new Set([
    ...configuredCliAdapters.map((adapter) => adapter.provider),
    ...(options.a2aAdapters ?? []).map((adapter) => adapter.provider),
  ]);
  const manualAdapters = ["claude", "antigravity", "custom"]
    .filter((provider) => !externallyConfiguredProviders.has(provider))
    .map((provider) => new ManualConfigurationAgentAdapter(`${provider}-manual-profile-required`, provider));
  const a2aStateFilePath = options.a2aStateFilePath ?? process.env.HIVE_A2A_STATE_FILE?.trim();
  const configuredSessionIdentityFilePath = options.sessionIdentityFilePath ?? process.env.HIVE_SESSION_IDENTITIES_FILE?.trim();
  const sessionIdentities = new FileSessionIdentityStore(
    configuredSessionIdentityFilePath || join(homedir(), ".hive", "session-identities.json"),
  );
  const a2aRuntime = createA2ARuntime({
    adapters: [
      new HiveSessionAgentAdapter({
        adapterId: "hive-codex-session",
        provider: "codex",
        targets: configuredTargets.codex ?? [],
        catalog: providers.catalogs.codex,
        conversations: providers.conversations.codex,
        sessions: providers.sessions.codex,
        sessionIdentities,
        settings: providers.settings.codex,
        isPermissionProfileSupported: isCodexPermissionPreset,
        turns: providers.turns.codex,
        subscribe: subscribeAssistantEvents,
        publishEvent: publishAssistantEvent,
        delegationAvailable: isA2AHttpToolProvisionEnabled(),
        canDelegateSession: (session) => isCodexA2AToolConfigured(session.sessionId),
      }),
      new HiveSessionAgentAdapter({
        adapterId: "hive-opencode-session",
        provider: "opencode",
        targets: configuredTargets.opencode ?? [],
        catalog: providers.catalogs.opencode,
        conversations: providers.conversations.opencode,
        sessions: providers.sessions.opencode,
        sessionIdentities,
        settings: providers.settings.opencode,
        permissionHandling: "preserve-target",
        turns: providers.turns.opencode,
        subscribe: subscribeAssistantEvents,
        publishEvent: publishAssistantEvent,
        delegationAvailable: isOpenCodeA2AToolProvisionAvailable(),
        canDelegateSession: () => isOpenCodeA2AToolConfigured(),
      }),
      new HiveSessionAgentAdapter({
        adapterId: "hive-pi-session",
        provider: "pi",
        targets: configuredTargets.pi ?? [],
        catalog: providers.catalogs.pi,
        conversations: providers.conversations.pi,
        sessions: providers.sessions.pi,
        sessionIdentities,
        settings: providers.settings.pi,
        permissionHandling: "preserve-target",
        turns: providers.turns.pi,
        subscribe: subscribeAssistantEvents,
        publishEvent: publishAssistantEvent,
        delegationAvailable: isA2AHttpToolProvisionEnabled(),
        canDelegateSession: () => piA2AToolsConfigured(),
      }),
      new HiveSessionAgentAdapter({
        adapterId: "hive-kiro-session",
        provider: "kiro",
        targets: configuredTargets.kiro ?? [],
        catalog: providers.catalogs.kiro,
        conversations: providers.conversations.kiro,
        sessions: providers.sessions.kiro,
        sessionIdentities,
        settings: providers.settings.kiro,
        isPermissionProfileSupported: isKiroPermissionProfile,
        turns: providers.turns.kiro,
        subscribe: subscribeAssistantEvents,
        publishEvent: publishAssistantEvent,
        delegationAvailable: isA2AHttpToolProvisionEnabled(),
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
    sessionIdentities,
    publishAssistantEvent,
  });
  const a2aReady = a2aRuntime.initialize();
  void a2aReady.catch(() => undefined);
  return { sessionIdentities, a2aRuntime, a2aReady };
}
