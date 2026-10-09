import type { AssistantEvent } from "../../application/ports/events.js";
import type { ProviderCatalogPort } from "../../application/ports/provider-catalog.js";
import type { ProviderConversationPort } from "../../application/ports/provider-conversations.js";
import type { ProviderSessionPort } from "../../application/ports/provider-sessions.js";
import { resolveHiveSessionIdentity } from "../../application/use-cases/session-identity-resolution.js";
import type { SessionIdentityPort } from "../../application/ports/session-identities.js";
import type { ProviderSettingsPort } from "../../application/ports/provider-settings.js";
import type { AdapterErrorCode } from "../../domain/a2a-adapter.js";
import type { A2AAgentPermissionProfileDto as AgentPermissionProfile } from "../../application/dto/a2a-collaboration.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { HiveSessionIdentity } from "../../domain/session-identity.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import {
  decodeHiveSessionAddressForProvider,
  encodeHiveSessionAddressKey,
  type HiveSessionAddress,
} from "./hive-session-agent-address.js";
import { HiveSessionProvisioner } from "./hive-session-provisioner.js";
import { hiveSessionProviderFault } from "./hive-session-agent-error.js";

type HiveSessionDirectoryOptions<Provider extends AssistantProvider> = {
  provider: Provider;
  targets: readonly string[];
  catalog: Pick<Record<Provider, ProviderCatalogPort>, Provider>[Provider];
  conversations: Pick<Record<Provider, ProviderConversationPort>, Provider>[Provider];
  sessions: Pick<Record<Provider, ProviderSessionPort>, Provider>[Provider];
  sessionIdentities: SessionIdentityPort;
  settings?: Pick<Record<Provider, ProviderSettingsPort>, Provider>[Provider];
  isPermissionProfileSupported?: (profile: string) => boolean;
  publishEvent(event: AssistantEvent): void;
  isTemporarySession(address: HiveSessionAddress): boolean;
};

/** Discovers and provisions provider sessions that Hive registers as A2A targets. */
export class HiveSessionDirectory<Provider extends AssistantProvider> {
  private readonly createdSessionIds = new Set<string>();
  private discoveryFailures: AdapterErrorCode[] = [];
  private readonly provisioner: HiveSessionProvisioner<Provider>;

  constructor(private readonly options: HiveSessionDirectoryOptions<Provider>) {
    this.provisioner = new HiveSessionProvisioner({
      provider: options.provider,
      targets: options.targets,
      conversations: options.conversations,
      sessions: options.sessions,
      sessionIdentities: options.sessionIdentities,
      ...(options.settings ? { settings: options.settings } : {}),
      canInheritPermissionProfile: (session, profile) => this.canInheritPermissionProfile(session, profile),
      publishEvent: options.publishEvent,
      markCreated: (sessionId) => this.createdSessionIds.add(sessionId),
    });
  }

  getDiscoveryFailures(): AdapterErrorCode[] {
    return [...this.discoveryFailures];
  }

  async discoverSessions(): Promise<NativeSession[]> {
    const sessions: NativeSession[] = [];
    this.discoveryFailures = [];
    for (const target of this.options.targets) {
      try {
        const { threads } = await this.options.catalog.connect(target);
        for (const thread of threads) {
          if (thread.provider !== this.options.provider || !thread.id.trim()) continue;
          const identity = await resolveHiveSessionIdentity(
            this.options.sessionIdentities,
            this.options.provider,
            target,
            thread.id,
            thread.title,
          );
          const address = { target, threadId: thread.id };
          const sessionId = encodeHiveSessionAddressKey(address);
          if (this.options.isTemporarySession(address)) continue;
          this.createdSessionIds.delete(sessionId);
          sessions.push({
            sessionId,
            callerAgentId: identity.hiveSessionId,
            provider: this.options.provider,
            sessionName: identity.sessionName,
            ...(thread.cwd ? { workspace: thread.cwd } : {}),
            persistenceLevel: 2,
            runtimeManagedHistory: false,
          });
        }
      } catch {
        // A target failing to connect must not hide sessions from the other configured targets.
        this.discoveryFailures.push("PROVIDER_UNAVAILABLE");
      }
    }
    return sessions;
  }

  async createSession(
    source: NativeSession,
    input: { sessionName?: string; inheritedPermissions?: AgentPermissionProfile },
  ): Promise<NativeSession> {
    return this.provisioner.createSession(source, input);
  }

  async ensureSessionMetadata(session: NativeSession): Promise<HiveSessionIdentity> {
    const address = decodeHiveSessionAddressForProvider(session, this.options.provider);
    if (!address) throw hiveSessionProviderFault("SESSION_NOT_FOUND", "The provider session address is invalid");
    return resolveHiveSessionIdentity(
      this.options.sessionIdentities,
      this.options.provider,
      address.target,
      address.threadId,
      session.sessionName,
    );
  }

  async ensureSessionIdentity(session: NativeSession): Promise<string> {
    return (await this.ensureSessionMetadata(session)).hiveSessionId;
  }

  async isAvailable(session: NativeSession): Promise<boolean> {
    const address = decodeHiveSessionAddressForProvider(session, this.options.provider);
    if (!address || !this.options.targets.includes(address.target)) return false;
    const sessionId = encodeHiveSessionAddressKey(address);
    if (this.createdSessionIds.has(sessionId)) return true;
    const { threads } = await this.options.catalog.connect(address.target);
    return threads.some((thread) => thread.provider === this.options.provider && thread.id === address.threadId);
  }

  canInheritPermissionProfile(session: NativeSession, profile: AgentPermissionProfile): boolean {
    return Boolean(
      decodeHiveSessionAddressForProvider(session, this.options.provider) &&
      profile.provider === this.options.provider &&
      this.options.settings &&
      this.options.isPermissionProfileSupported?.(profile.profile),
    );
  }

  onNativeSessionDeleted(session: NativeSession): void {
    const address = decodeHiveSessionAddressForProvider(session, this.options.provider);
    if (address) this.createdSessionIds.delete(encodeHiveSessionAddressKey(address));
  }

  observeNativeEvent(event: AssistantEvent): void {
    if (event.provider !== this.options.provider || event.type !== "threadDeleted") return;
    this.createdSessionIds.delete(encodeHiveSessionAddressKey({ target: event.target, threadId: event.threadId }));
  }
}
