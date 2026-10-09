import type { ProviderConversationPort } from "../../application/ports/provider-conversations.js";
import type { ProviderSessionPort } from "../../application/ports/provider-sessions.js";
import type { ProviderSettingsPort } from "../../application/ports/provider-settings.js";
import type { A2AAgentPermissionProfileDto as AgentPermissionProfile } from "../../application/dto/a2a-collaboration.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { decodeHiveSessionAddressForProvider, type HiveSessionAddress } from "./hive-session-agent-address.js";
import { HiveSessionTurnRegistry } from "./hive-session-turn-registry.js";

type HiveSessionTaskThreadLifecycleOptions<Provider extends AssistantProvider> = {
  provider: Provider;
  conversations: Pick<Record<Provider, ProviderConversationPort>, Provider>[Provider];
  sessions: Pick<Record<Provider, ProviderSessionPort>, Provider>[Provider];
  settings?: Pick<Record<Provider, ProviderSettingsPort>, Provider>[Provider];
  registry: HiveSessionTurnRegistry;
  isPermissionProfileSupported?: (profile: string) => boolean;
};

type OpenedProviderThread = Awaited<ReturnType<ProviderConversationPort["openThread"]>>;
type CreatedProviderThread = Awaited<ReturnType<ProviderConversationPort["createThread"]>>;

export type HiveSessionTaskThread = {
  address: HiveSessionAddress;
  current: OpenedProviderThread;
  created: CreatedProviderThread;
  requiresFocusRestoreAfterDelete: boolean;
};

/** Creates and cleans up an isolated provider thread for one Hive task. */
export class HiveSessionTaskThreadLifecycle<Provider extends AssistantProvider> {
  constructor(private readonly options: HiveSessionTaskThreadLifecycleOptions<Provider>) {}

  openRegisteredThread(address: HiveSessionAddress): Promise<OpenedProviderThread> {
    return this.options.conversations.openThread(address.target, address.threadId, { includeTranscript: false, minimal: true });
  }

  resolveWorkspace(session: NativeSession, current: OpenedProviderThread): string {
    const workspace = session.workspace?.trim() || current.cwd.trim();
    if (!workspace) throw providerFault("WORKSPACE_NOT_FOUND", "The registered provider session has no workspace path");
    return workspace;
  }

  async createTaskThread(
    session: NativeSession,
    ownerAddress: HiveSessionAddress,
    current: OpenedProviderThread,
    workspace: string,
  ): Promise<HiveSessionTaskThread> {
    const created = await this.options.conversations.createThread(ownerAddress.target, {
      cwd: workspace,
      model: current.model,
      minimal: true,
      preserveActiveThread: true,
      ...(session.callerAgentId ? { a2aCallerAgentId: session.callerAgentId } : {}),
      ...(this.options.provider === "codex" ? { ephemeral: true } : {}),
    });
    const address = { target: ownerAddress.target, threadId: created.threadId };
    this.options.registry.markTemporary(address);
    return {
      address,
      current,
      created,
      requiresFocusRestoreAfterDelete: created.requiresFocusRestoreAfterDelete ?? true,
    };
  }

  async copySettings(
    session: NativeSession,
    taskThread: HiveSessionTaskThread,
    inherited: AgentPermissionProfile | undefined,
  ): Promise<void> {
    if (inherited && !this.canInheritPermissionProfile(session, inherited)) {
      throw providerFault("PERMISSION_DENIED", "The target provider cannot apply the caller's permission profile");
    }
    const permissionProfile = inherited?.profile ?? taskThread.current.permissionProfile ?? undefined;
    if (taskThread.current.permissionProfile && !inherited && this.options.isPermissionProfileSupported &&
        !this.options.isPermissionProfileSupported(taskThread.current.permissionProfile)) {
      throw providerFault("PERMISSION_DENIED", "The target session's permission profile cannot be copied safely");
    }
    const update = {
      ...(taskThread.current.model && taskThread.current.model !== taskThread.created.model ? { model: taskThread.current.model } : {}),
      ...(taskThread.current.reasoningEffort && taskThread.current.reasoningEffort !== taskThread.created.reasoningEffort
        ? { effort: taskThread.current.reasoningEffort }
        : {}),
      ...(permissionProfile && permissionProfile !== taskThread.created.permissionProfile ? { permissionProfile } : {}),
      ...(taskThread.current.currentModeId && taskThread.current.currentModeId !== taskThread.created.currentModeId
        ? { modeId: taskThread.current.currentModeId }
        : {}),
    };
    if (!Object.keys(update).length) return;
    if (!this.options.settings) {
      throw providerFault("PROVIDER_UNAVAILABLE", "The provider cannot copy the registered session settings to an isolated A2A session");
    }
    await this.options.settings.updateThreadSettings(taskThread.address.target, taskThread.address.threadId, update);
  }

  async cleanupTaskThread(
    ownerAddress: HiveSessionAddress,
    taskThread: Pick<HiveSessionTaskThread, "address" | "requiresFocusRestoreAfterDelete">,
  ): Promise<void> {
    try {
      await this.options.sessions.deleteThread(taskThread.address.target, taskThread.address.threadId);
      this.options.registry.forgetTemporary(taskThread.address);
    } catch {
      // Keep an undeleted task thread out of discovery for the rest of this process.
    }
    if (taskThread.requiresFocusRestoreAfterDelete) {
      try {
        await this.options.conversations.openThread(ownerAddress.target, ownerAddress.threadId, { includeTranscript: false, minimal: true });
      } catch {
        // The task result remains valid if the provider cannot restore the original thread focus.
      }
    }
  }

  private canInheritPermissionProfile(session: NativeSession, profile: AgentPermissionProfile): boolean {
    return Boolean(
      decodeHiveSessionAddressForProvider(session, this.options.provider) &&
      profile.provider === this.options.provider &&
      this.options.settings &&
      this.options.isPermissionProfileSupported?.(profile.profile),
    );
  }
}

function providerFault(code: string, message: string): Error & { code: string; provider: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, provider: "", retryable: code === "PROVIDER_UNAVAILABLE" });
}
