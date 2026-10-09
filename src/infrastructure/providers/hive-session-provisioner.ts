import type { AssistantEvent } from "../../application/ports/events.js";
import type { ProviderConversationPort, ProviderCreateThreadResult } from "../../application/ports/provider-conversations.js";
import type { ProviderSessionPort } from "../../application/ports/provider-sessions.js";
import type { SessionIdentityPort } from "../../application/ports/session-identities.js";
import type { ProviderSettingsPort } from "../../application/ports/provider-settings.js";
import type { A2AAgentPermissionProfileDto as AgentPermissionProfile } from "../../application/dto/a2a-collaboration.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { HiveSessionIdentity } from "../../domain/session-identity.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { assistantProviderSupports } from "../../domain/provider-catalog.js";
import { bindHiveSessionIdentity } from "../../application/use-cases/session-identity-resolution.js";
import { encodeHiveSessionAddressKey, decodeHiveSessionAddressForProvider } from "./hive-session-agent-address.js";
import { hiveSessionProviderFault } from "./hive-session-agent-error.js";

type HiveSessionProvisionerOptions<Provider extends AssistantProvider> = {
  provider: Provider;
  targets: readonly string[];
  conversations: Pick<Record<Provider, ProviderConversationPort>, Provider>[Provider];
  sessions: Pick<Record<Provider, ProviderSessionPort>, Provider>[Provider];
  sessionIdentities: SessionIdentityPort;
  settings?: Pick<Record<Provider, ProviderSettingsPort>, Provider>[Provider];
  canInheritPermissionProfile(session: NativeSession, profile: AgentPermissionProfile): boolean;
  publishEvent(event: AssistantEvent): void;
  markCreated(sessionId: string): void;
};

/** Creates an A2A provider session and compensates partial creation failures. */
export class HiveSessionProvisioner<Provider extends AssistantProvider> {
  constructor(private readonly options: HiveSessionProvisionerOptions<Provider>) {}

  async createSession(
    source: NativeSession,
    input: { sessionName?: string; inheritedPermissions?: AgentPermissionProfile },
  ): Promise<NativeSession> {
    const address = decodeHiveSessionAddressForProvider(source, this.options.provider);
    const workspace = source.workspace?.trim();
    if (!address || !this.options.targets.includes(address.target)) {
      throw hiveSessionProviderFault("SESSION_CREATE_UNSUPPORTED", "The caller session is not managed by this Hive provider adapter");
    }
    if (!workspace) throw hiveSessionProviderFault("WORKSPACE_NOT_FOUND", "The caller session has no workspace path for a new A2A session");
    const sessionName = input.sessionName?.trim();
    if (sessionName && !assistantProviderSupports(this.options.provider, "createNamedSessions") &&
        !assistantProviderSupports(this.options.provider, "renameSessions")) {
      throw hiveSessionProviderFault("SESSION_CREATE_UNSUPPORTED", "This provider cannot name the new A2A session");
    }
    const inherited = input.inheritedPermissions;
    if (inherited && (!this.options.settings || !this.options.canInheritPermissionProfile(source, inherited))) {
      throw hiveSessionProviderFault("PERMISSION_DENIED", "The new session cannot inherit the caller's permission profile");
    }

    const callerAgentId = await this.options.sessionIdentities.reserve();
    let created: ProviderCreateThreadResult;
    let assignedIdentity: HiveSessionIdentity | undefined;
    try {
      created = await this.options.conversations.createThread(address.target, {
        cwd: workspace,
        hiveSessionId: callerAgentId,
        ...(sessionName && assistantProviderSupports(this.options.provider, "createNamedSessions") ? { name: sessionName } : {}),
      });
    } catch (error) {
      this.options.sessionIdentities.release(callerAgentId);
      throw error;
    }
    let finalName = created.title.trim() || created.thread.title.trim() || sessionName || "";
    try {
      if (sessionName && !assistantProviderSupports(this.options.provider, "createNamedSessions")) {
        await this.options.sessions.renameThread(address.target, created.threadId, sessionName);
        finalName = sessionName;
      }
      if (inherited) {
        await this.options.settings!.updateThreadSettings(address.target, created.threadId, { permissionProfile: inherited.profile });
      }
      assignedIdentity = await bindHiveSessionIdentity(
        this.options.sessionIdentities,
        this.options.provider,
        address.target,
        created.threadId,
        callerAgentId,
        finalName,
      );
      finalName = assignedIdentity.sessionName;
    } catch (error) {
      this.options.sessionIdentities.release(callerAgentId);
      try {
        await this.options.sessions.deleteThread(address.target, created.threadId);
      } catch {
        throw hiveSessionProviderFault("PROVIDER_UNAVAILABLE", "Could not finish provisioning the A2A session or remove its partial provider session");
      }
      throw error;
    }

    const nativeSession: NativeSession = {
      sessionId: encodeHiveSessionAddressKey({ target: address.target, threadId: created.threadId }),
      callerAgentId: assignedIdentity!.hiveSessionId,
      provider: this.options.provider,
      sessionName: finalName,
      workspace,
      persistenceLevel: 2,
      runtimeManagedHistory: false,
    };
    this.options.markCreated(nativeSession.sessionId);
    this.options.publishEvent({
      type: "threadCreated",
      target: address.target,
      threadId: created.threadId,
      provider: this.options.provider,
      title: finalName,
      cwd: workspace,
      preview: created.thread.preview,
      updatedAt: created.thread.updatedAt,
      hiveSessionId: assignedIdentity!.hiveSessionId,
    });
    return nativeSession;
  }
}
