import type { AssistantEvent } from "../../application/ports/events.js";
import type { AgentAdapter, AgentExecutionContext } from "../../application/ports/a2a-agent-adapter.js";
import type { ProviderCatalogPort } from "../../application/ports/provider-catalog.js";
import type { ProviderConversationPort } from "../../application/ports/provider-conversations.js";
import type { ProviderSessionPort } from "../../application/ports/provider-sessions.js";
import type { SessionIdentityPort } from "../../application/ports/session-identities.js";
import type { HiveSessionIdentity } from "../../domain/session-identity.js";
import type { ProviderSettingsPort } from "../../application/ports/provider-settings.js";
import type { ProviderTurnsPort } from "../../application/ports/provider-turns.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { AdapterCapabilities, AdapterErrorCode } from "../../domain/a2a-adapter.js";
import type {
  A2AAgentInputDto as AgentInput,
  A2AAgentPermissionProfileDto as AgentPermissionProfile,
  A2ATaskDto as AgentTask,
  A2ATaskResultDto as AgentResult,
} from "../../application/dto/a2a-collaboration.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import { hiveSessionFailedResult } from "./hive-session-agent-error.js";
import { HiveSessionDirectory } from "./hive-session-directory.js";
import { HiveSessionNativeTurnActivity } from "./hive-session-native-turn-activity.js";
import { HiveSessionTurnRunner } from "./hive-session-turn-runner.js";
import {
  decodeHiveSessionAddressForProvider as decodeAddress,
  type HiveSessionAddress,
} from "./hive-session-agent-address.js";
import { resumeHiveSessionTask } from "./hive-session-task-resume.js";

export type HiveSessionAgentAdapterOptions<Provider extends AssistantProvider> = {
  adapterId: string;
  provider: Provider;
  targets: readonly string[];
  catalog: Pick<Record<Provider, ProviderCatalogPort>, Provider>[Provider];
  conversations: Pick<Record<Provider, ProviderConversationPort>, Provider>[Provider];
  sessions: Pick<Record<Provider, ProviderSessionPort>, Provider>[Provider];
  sessionIdentities: SessionIdentityPort;
  settings?: Pick<Record<Provider, ProviderSettingsPort>, Provider>[Provider];
  isPermissionProfileSupported?: (profile: string) => boolean;
  permissionHandling?: "inherit-caller" | "preserve-target";
  turns: Pick<Record<Provider, ProviderTurnsPort>, Provider>[Provider];
  subscribe(handler: (event: AssistantEvent) => void): () => void;
  publishEvent(event: AssistantEvent): void;
  delegationAvailable?: boolean;
  canDelegateSession?: (session: NativeSession) => boolean;
};

const BASE_CAPABILITIES = {
  discoverSessions: true,
  attachExistingProcess: false,
  resumeSession: true,
  persistentContext: true,
  structuredOutput: true,
  streaming: false,
  cancellation: true,
  toolCalling: true,
  fileAccess: true,
  shellAccess: true,
  delegation: false,
  concurrentTasks: false,
} as const;

/** Connects A2A tasks to provider sessions already exposed through Hive's session ports. */
export class HiveSessionAgentAdapter<Provider extends AssistantProvider> implements AgentAdapter {
  readonly provider: string;
  readonly permissionHandling: "inherit-caller" | "preserve-target";
  readonly integrationStatus = "PARTIALLY_VERIFIED" as const;
  readonly capabilities: AdapterCapabilities;
  readonly evidence: {
    source: "hive-provider-port";
    verifiedAt: string;
    confidence: "medium";
    limitations: string[];
  };

  private readonly directory: HiveSessionDirectory<Provider>;
  private readonly nativeTurnActivity: HiveSessionNativeTurnActivity;
  private readonly turnRunner: HiveSessionTurnRunner<Provider>;

  constructor(private readonly options: HiveSessionAgentAdapterOptions<Provider>) {
    if (!options.adapterId.trim()) throw new Error("A2A adapterId must be non-empty");
    this.provider = options.provider;
    this.nativeTurnActivity = new HiveSessionNativeTurnActivity(options.provider);
    this.permissionHandling = options.permissionHandling ?? "inherit-caller";
    this.capabilities = Object.freeze({ ...BASE_CAPABILITIES, delegation: options.delegationAvailable === true });
    this.evidence = Object.freeze({
      source: "hive-provider-port",
      verifiedAt: "2026-09-29",
      confidence: "medium",
      limitations: [
        "Uses Hive's provider session ports; it does not attach to an external UI process.",
        "Session discovery is restricted to explicitly configured Hive targets.",
        "Availability and cancellation depend on the provider port and its active session connection.",
        "Provider permissions can still restrict native tool, file, or shell access.",
        "A2A and A2B requests are available only on native sessions where Hive injected the corresponding MCP tools.",
      ],
    });
    const targets = [...new Set(options.targets.map((target) => target.trim()).filter(Boolean))];
    this.turnRunner = new HiveSessionTurnRunner({
      provider: options.provider,
      conversations: options.conversations,
      sessions: options.sessions,
      ...(options.settings ? { settings: options.settings } : {}),
      turns: options.turns,
      subscribe: options.subscribe,
      publishEvent: options.publishEvent,
      ...(options.isPermissionProfileSupported ? { isPermissionProfileSupported: options.isPermissionProfileSupported } : {}),
    });
    this.directory = new HiveSessionDirectory({
      provider: options.provider,
      targets,
      catalog: options.catalog,
      conversations: options.conversations,
      sessions: options.sessions,
      sessionIdentities: options.sessionIdentities,
      ...(options.settings ? { settings: options.settings } : {}),
      ...(options.isPermissionProfileSupported ? { isPermissionProfileSupported: options.isPermissionProfileSupported } : {}),
      publishEvent: options.publishEvent,
      isTemporarySession: (address) => this.turnRunner.isTemporarySession(address),
    });
    options.subscribe((event) => {
      this.directory.observeNativeEvent(event);
      this.nativeTurnActivity.observe(event);
    });
  }

  get adapterId(): string { return this.options.adapterId; }

  canDelegate(session: NativeSession): boolean {
    return this.capabilities.delegation && (this.options.canDelegateSession?.(session) ?? true);
  }

  async getPermissionProfile(session: NativeSession, activeTask?: AgentTask): Promise<AgentPermissionProfile | undefined> {
    const ownerAddress = decodeAddress(session, this.options.provider);
    if (!ownerAddress) return undefined;
    const address = activeTask ? this.turnRunner.getActiveTaskAddress(session, activeTask.taskId) ?? ownerAddress : ownerAddress;
    const view = await this.options.conversations.openThread(address.target, address.threadId, { includeTranscript: false, minimal: true });
    const profile = view.permissionProfile;
    if (!profile || !this.options.isPermissionProfileSupported?.(profile)) return undefined;
    return { provider: this.options.provider, profile };
  }

  canInheritPermissionProfile(session: NativeSession, profile: AgentPermissionProfile): boolean {
    return this.directory.canInheritPermissionProfile(session, profile);
  }

  matchesNativeSession(session: NativeSession, nativeSessionId: string): boolean {
    return this.turnRunner.matchesNativeSession(session, nativeSessionId);
  }

  matchesNativeSessionOwner(session: NativeSession, nativeSessionId: string): boolean {
    return decodeAddress(session, this.options.provider)?.threadId === nativeSessionId;
  }

  onNativeSessionDeleted(session: NativeSession): void {
    const address = decodeAddress(session, this.options.provider);
    if (!address) return;
    this.directory.onNativeSessionDeleted(session);
    this.turnRunner.onNativeSessionDeleted(address);
    this.nativeTurnActivity.onNativeSessionDeleted(address);
  }

  getActiveTaskIdForSession(session: NativeSession, nativeSessionId: string): string | undefined {
    return this.turnRunner.getActiveTaskIdForSession(session, nativeSessionId);
  }

  matchesNativeTarget(session: NativeSession, target: string): boolean {
    return decodeAddress(session, this.options.provider)?.target === target;
  }

  getPromptAddress(session: NativeSession): HiveSessionAddress | undefined {
    return decodeAddress(session, this.options.provider);
  }

  getDiscoveryFailures(): AdapterErrorCode[] { return this.directory.getDiscoveryFailures(); }

  async discoverSessions(): Promise<NativeSession[]> { return this.directory.discoverSessions(); }

  async createSession(source: NativeSession, input: { sessionName?: string; inheritedPermissions?: AgentPermissionProfile }): Promise<NativeSession> {
    return this.directory.createSession(source, input);
  }

  async ensureSessionIdentity(session: NativeSession): Promise<string> { return this.directory.ensureSessionIdentity(session); }

  async ensureSessionMetadata(session: NativeSession): Promise<HiveSessionIdentity> {
    return this.directory.ensureSessionMetadata(session);
  }

  async isAvailable(session: NativeSession): Promise<boolean> { return this.directory.isAvailable(session); }

  async isBusy(session: NativeSession): Promise<boolean> {
    const address = decodeAddress(session, this.options.provider);
    if (!address) return false;
    return this.turnRunner.isBusy(address) || this.nativeTurnActivity.isBusy(address);
  }

  async execute(_session: NativeSession, task: AgentTask, _context: AgentExecutionContext): Promise<AgentResult> {
    return hiveSessionFailedResult(task, "RESUME_UNSUPPORTED", "This adapter only operates on registered existing sessions.");
  }

  async resume(session: NativeSession, input: AgentInput, context: AgentExecutionContext): Promise<AgentResult> {
    return resumeHiveSessionTask({
      provider: this.options.provider,
      turnRunner: this.turnRunner,
      session,
      input,
      context,
      canDelegate: (targetSession) => this.canDelegate(targetSession),
    });
  }

  async cancel(session: NativeSession, taskId: string): Promise<void> {
    return this.turnRunner.cancel(session, taskId);
  }
}
