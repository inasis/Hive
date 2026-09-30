import type { AssistantEvent, AssistantEventPublisher } from "../../application/ports/events.js";
import type { AgentAdapter, AgentExecutionContext } from "../../application/ports/a2a-runtime.js";
import type { ProviderCatalogPort } from "../../application/ports/provider-catalog.js";
import type { ProviderConversationPort } from "../../application/ports/provider-conversations.js";
import type { ProviderSessionPort } from "../../application/ports/provider-sessions.js";
import type { ProviderSettingsPort } from "../../application/ports/provider-settings.js";
import type { ProviderPromptInput, ProviderTurnsPort } from "../../application/ports/provider-turns.js";
import type { PendingA2ACommunication } from "../../application/ports/a2a-prompt-inbox.js";
import { a2aCommunicationGroupKey } from "../../domain/a2a.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { assistantProviderSupports } from "../../domain/provider-catalog.js";
import type { AdapterCapabilities, AdapterErrorCode, AgentInput, AgentPermissionProfile, AgentResult, AgentTask, NativeSession } from "../../domain/a2a.js";

export type HiveSessionAgentAdapterOptions<Provider extends AssistantProvider> = {
  adapterId: string;
  provider: Provider;
  targets: readonly string[];
  catalog: Pick<Record<Provider, ProviderCatalogPort>, Provider>[Provider];
  conversations: Pick<Record<Provider, ProviderConversationPort>, Provider>[Provider];
  sessions: Pick<Record<Provider, ProviderSessionPort>, Provider>[Provider];
  settings?: Pick<Record<Provider, ProviderSettingsPort>, Provider>[Provider];
  isPermissionProfileSupported?: (profile: string) => boolean;
  permissionHandling?: "inherit-caller" | "preserve-target";
  turns: Pick<Record<Provider, ProviderTurnsPort>, Provider>[Provider];
  subscribe(handler: (event: AssistantEvent) => void): () => void;
  publishEvent(event: AssistantEvent): void;
  delegationAvailable?: boolean;
  canDelegateSession?: (session: NativeSession) => boolean;
};

export type HiveSessionAddress = { target: string; threadId: string };
type SessionAddress = HiveSessionAddress;
type TurnCompletion = Extract<AssistantEvent, { type: "turnCompleted" }>;
type ActiveTask = {
  ownerAddress: SessionAddress;
  address?: SessionAddress;
  turnId?: string;
  messages: Map<string, string>;
  accepted: boolean;
  cancelRequested: boolean;
  completion?: TurnCompletion;
  completionPromise: Promise<TurnCompletion>;
  resolveCompletion(value: TurnCompletion): void;
  cancellationPromise: Promise<void>;
  resolveCancellation(): void;
  nativeFinished: boolean;
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

  private readonly targets: readonly string[];
  private readonly activeTasks = new Map<string, ActiveTask>();
  private readonly ephemeralSessionIds = new Set<string>();
  private readonly nativeTurns = new Map<string, string | undefined>();
  private readonly createdSessionIds = new Set<string>();
  private discoveryFailures: AdapterErrorCode[] = [];

  constructor(private readonly options: HiveSessionAgentAdapterOptions<Provider>) {
    if (!options.adapterId.trim()) throw new Error("A2A adapterId must be non-empty");
    this.provider = options.provider;
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
        "A2A delegation is available only on native sessions where Hive injected the a2a_send tool.",
      ],
    });
    this.targets = [...new Set(options.targets.map((target) => target.trim()).filter(Boolean))];
    options.subscribe((event) => this.observeNativeTurn(event));
  }

  get adapterId(): string { return this.options.adapterId; }

  canDelegate(session: NativeSession): boolean {
    return this.capabilities.delegation && (this.options.canDelegateSession?.(session) ?? true);
  }

  async getPermissionProfile(session: NativeSession): Promise<AgentPermissionProfile | undefined> {
    const address = decodeAddress(session, this.options.provider);
    if (!address) return undefined;
    const view = await this.options.conversations.openThread(address.target, address.threadId, { includeTranscript: false, minimal: true });
    const profile = view.permissionProfile;
    if (!profile || !this.options.isPermissionProfileSupported?.(profile)) return undefined;
    return { provider: this.options.provider, profile };
  }

  canInheritPermissionProfile(session: NativeSession, profile: AgentPermissionProfile): boolean {
    return Boolean(
      decodeAddress(session, this.options.provider) &&
      profile.provider === this.options.provider &&
      this.options.settings &&
      this.options.isPermissionProfileSupported?.(profile.profile),
    );
  }

  matchesNativeSession(session: NativeSession, nativeSessionId: string): boolean {
    const ownerAddress = decodeAddress(session, this.options.provider);
    if (!ownerAddress) return false;
    return ownerAddress.threadId === nativeSessionId || [...this.activeTasks.values()].some((active) =>
      active.ownerAddress.target === ownerAddress.target && active.address?.threadId === nativeSessionId,
    );
  }

  getActiveTaskIdForSession(session: NativeSession, nativeSessionId: string): string | undefined {
    const ownerAddress = decodeAddress(session, this.options.provider);
    if (!ownerAddress) return undefined;
    for (const [taskId, active] of this.activeTasks) {
      if (active.ownerAddress.target === ownerAddress.target && active.ownerAddress.threadId === ownerAddress.threadId &&
          active.address?.threadId === nativeSessionId) return taskId;
    }
    return undefined;
  }

  matchesNativeTarget(session: NativeSession, target: string): boolean {
    return decodeAddress(session, this.options.provider)?.target === target;
  }

  getPromptAddress(session: NativeSession): SessionAddress | undefined {
    return decodeAddress(session, this.options.provider);
  }

  getDiscoveryFailures(): AdapterErrorCode[] { return [...this.discoveryFailures]; }

  async discoverSessions(): Promise<NativeSession[]> {
    const sessions: NativeSession[] = [];
    this.discoveryFailures = [];
    for (const target of this.targets) {
      try {
        const { threads } = await this.options.catalog.connect(target);
        for (const thread of threads) {
          if (thread.provider !== this.options.provider || !thread.id.trim()) continue;
          const sessionId = encodeAddress({ target, threadId: thread.id });
          if (this.ephemeralSessionIds.has(sessionId)) continue;
          this.createdSessionIds.delete(sessionId);
          sessions.push({
            sessionId,
            provider: this.options.provider,
            ...(thread.title.trim() ? { sessionName: thread.title.trim() } : {}),
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

  async createSession(source: NativeSession, input: { sessionName?: string; inheritedPermissions?: AgentPermissionProfile }): Promise<NativeSession> {
    const address = decodeAddress(source, this.options.provider);
    const workspace = source.workspace?.trim();
    if (!address || !this.targets.includes(address.target)) {
      throw providerFault("SESSION_CREATE_UNSUPPORTED", "The caller session is not managed by this Hive provider adapter");
    }
    if (!workspace) throw providerFault("WORKSPACE_NOT_FOUND", "The caller session has no workspace path for a new A2A session");
    const sessionName = input.sessionName?.trim();
    if (sessionName && !assistantProviderSupports(this.options.provider, "createNamedSessions") &&
        !assistantProviderSupports(this.options.provider, "renameSessions")) {
      throw providerFault("SESSION_CREATE_UNSUPPORTED", "This provider cannot name the new A2A session");
    }
    const inherited = input.inheritedPermissions;
    if (inherited && (!this.options.settings || !this.canInheritPermissionProfile({
      sessionId: encodeAddress(address),
      provider: this.options.provider,
      workspace,
      persistenceLevel: 2,
      runtimeManagedHistory: false,
    }, inherited))) {
      throw providerFault("PERMISSION_DENIED", "The new session cannot inherit the caller's permission profile");
    }

    const created = await this.options.conversations.createThread(address.target, {
      cwd: workspace,
      ...(sessionName && assistantProviderSupports(this.options.provider, "createNamedSessions") ? { name: sessionName } : {}),
    });
    let finalName = created.title.trim() || created.thread.title.trim() || "새 세션";
    try {
      if (sessionName && !assistantProviderSupports(this.options.provider, "createNamedSessions")) {
        await this.options.sessions.renameThread(address.target, created.threadId, sessionName);
        finalName = sessionName;
      }
      if (inherited) {
        await this.options.settings!.updateThreadSettings(address.target, created.threadId, { permissionProfile: inherited.profile });
      }
    } catch (error) {
      try {
        await this.options.sessions.deleteThread(address.target, created.threadId);
      } catch {
        throw providerFault("PROVIDER_UNAVAILABLE", "Could not finish provisioning the A2A session or remove its partial provider session");
      }
      throw error;
    }

    const nativeSession: NativeSession = {
      sessionId: encodeAddress({ target: address.target, threadId: created.threadId }),
      provider: this.options.provider,
      sessionName: finalName,
      workspace,
      persistenceLevel: 2,
      runtimeManagedHistory: false,
    };
    this.createdSessionIds.add(nativeSession.sessionId);
    this.options.publishEvent({
      type: "threadCreated",
      target: address.target,
      threadId: created.threadId,
      provider: this.options.provider,
      title: finalName,
      cwd: workspace,
      preview: created.thread.preview,
      updatedAt: created.thread.updatedAt,
    });
    return nativeSession;
  }

  async isAvailable(session: NativeSession): Promise<boolean> {
    const address = decodeAddress(session, this.options.provider);
    if (!address || !this.targets.includes(address.target)) return false;
    const sessionId = encodeAddress(address);
    if (this.createdSessionIds.has(sessionId)) return true;
    const { threads } = await this.options.catalog.connect(address.target);
    const available = threads.some((thread) => thread.provider === this.options.provider && thread.id === address.threadId);
    return available;
  }

  async isBusy(session: NativeSession): Promise<boolean> {
    const address = decodeAddress(session, this.options.provider);
    if (!address) return false;
    const key = encodeAddress(address);
    return this.nativeTurns.has(key) || [...this.activeTasks.values()].some((active) => encodeAddress(active.ownerAddress) === key);
  }

  async execute(_session: NativeSession, task: AgentTask, _context: AgentExecutionContext): Promise<AgentResult> {
    return failedResult(task, "RESUME_UNSUPPORTED", "This adapter only operates on registered existing sessions.");
  }

  async resume(session: NativeSession, input: AgentInput, context: AgentExecutionContext): Promise<AgentResult> {
    const address = decodeAddress(session, this.options.provider);
    if (!address || !this.targets.includes(address.target)) {
      return failedResult(input.task, "SESSION_NOT_FOUND", "The registered provider session is unavailable.");
    }
    if (context.signal.aborted) return cancelledResult(input.task);
    if (this.activeTasks.has(input.task.taskId)) throw new Error("A2A task ID is already active in this provider adapter");

    try {
      const message = buildTaskPrompt(input.task, context, input.message, this.canDelegate(session));
      const sourceName = context.agents.find((agent) => agent.agentId === input.task.sourceAgent)?.sessionName;
      const communication: PendingA2ACommunication = {
        kind: input.task.metadata?.delivery === "a2a-result-callback" ? "result" : "request",
        taskId: input.task.taskId,
        sourceAgentId: input.task.sourceAgent,
        ...(sourceName ? { sourceSessionName: sourceName } : {}),
        message,
      };
      const turn = await this.runNativeTurn(session, address, input.task, context, {
        text: "",
        a2aCommunications: [communication],
      });
      return { taskId: input.task.taskId, agentId: input.task.targetAgent, ...turn };
    } catch (error) {
      if (context.signal.aborted) return cancelledResult(input.task);
      throw error;
    }
  }

  private async runNativeTurn(
    session: NativeSession,
    address: SessionAddress,
    task: AgentTask,
    context: AgentExecutionContext,
    prompt: ProviderPromptInput,
  ): Promise<Pick<AgentResult, "status" | "message">> {
    const active = createActiveTask(address);
    this.activeTasks.set(task.taskId, active);
    let unsubscribe: (() => void) | undefined;
    let accepted = false;
    let executionAddress: SessionAddress | undefined;
    let requiresFocusRestoreAfterDelete = true;
    let providerStage = "opening the registered session";
    try {
      providerStage = "opening the registered session";
      const current = await this.options.conversations.openThread(address.target, address.threadId, { includeTranscript: false, minimal: true });
      throwIfCancelled(context.signal);
      const workspace = session.workspace?.trim() || current.cwd.trim();
      if (!workspace) throw providerFault("WORKSPACE_NOT_FOUND", "The registered provider session has no workspace path");
      providerStage = "creating an ephemeral task session";
      const created = await this.options.conversations.createThread(address.target, {
        cwd: workspace,
        model: current.model,
        minimal: true,
        preserveActiveThread: true,
        ...(this.options.provider === "codex" ? { ephemeral: true } : {}),
      });
      requiresFocusRestoreAfterDelete = created.requiresFocusRestoreAfterDelete ?? true;
      executionAddress = { target: address.target, threadId: created.threadId };
      active.address = executionAddress;
      this.ephemeralSessionIds.add(encodeAddress(executionAddress));
      throwIfCancelled(context.signal);
      providerStage = "copying the registered session settings";
      await this.copyTaskThreadSettings(session, executionAddress, current, created, context.inheritedPermissions);
      throwIfCancelled(context.signal);
      providerStage = "preparing the provider prompt";
      await this.options.turns.assertPromptReady(executionAddress.target, executionAddress.threadId);

      const taskAddress = executionAddress;
      unsubscribe = this.options.subscribe((event) => {
        if (event.provider !== this.options.provider || event.target !== taskAddress.target || event.threadId !== taskAddress.threadId) return;
        if (event.type === "turnStarted" && event.turnId && !active.turnId) active.turnId = event.turnId;
        if (event.type === "assistantDelta" || event.type === "assistantMessageCompleted") {
          if (active.turnId && event.turnId !== active.turnId) return;
          const previous = active.messages.get(event.messageId) ?? "";
          active.messages.set(event.messageId, event.type === "assistantDelta" ? previous + event.text : event.text);
          return;
        }
        if (event.type !== "turnCompleted") return;
        if (active.turnId && event.turnId && active.turnId !== event.turnId) return;
        if (!active.turnId && event.turnId) active.turnId = event.turnId;
        active.completion = event;
        if (active.accepted) active.resolveCompletion(event);
      });

      providerStage = "submitting the provider prompt";
      const sent = await this.options.turns.sendPrompt(taskAddress.target, taskAddress.threadId, { ...prompt, cwd: workspace });
      if (!sent.accepted) throw providerFault("PROCESS_EXITED", "Provider did not accept the A2A task");
      accepted = true;
      active.accepted = true;
      if (sent.turnId) active.turnId = sent.turnId;
      if (active.completion) active.resolveCompletion(active.completion);
      if (active.cancelRequested || context.signal.aborted) {
        if (active.turnId) await this.options.turns.interruptTurn(taskAddress.target, taskAddress.threadId, active.turnId);
        active.nativeFinished = true;
        throw new Error("A2A task was cancelled before the provider accepted its turn");
      }

      const communications = prompt.a2aCommunications;
      const summaryCommunications = communications?.map((communication) => ({
        ...communication,
        ...(communication.taskId === task.taskId ? { message: task.message } : {}),
      })) ?? [];
      const summaryId = a2aCommunicationGroupKey(summaryCommunications);
      if (summaryCommunications.length) {
        this.options.publishEvent?.({
          type: "a2aCommunicationSummary",
          target: address.target,
          threadId: address.threadId,
          provider: this.options.provider,
          summaryId,
          communications: summaryCommunications,
        });
      }

      let completion: TurnCompletion;
      try {
        providerStage = "waiting for the provider turn";
        completion = await waitForCompletion(active.completionPromise, context.signal);
      } catch (error) {
        if (context.signal.aborted) await active.cancellationPromise;
        throw error;
      }
      active.nativeFinished = true;
      const output = collectTurnOutput(active.messages);
      const status = normalizedTurnStatus(completion);
      if (summaryCommunications.length && output) {
        const targetAgent = context.agents.find((agent) => agent.agentId === task.targetAgent);
        const resultCommunication: PendingA2ACommunication = {
          kind: "result",
          taskId: task.taskId,
          sourceAgentId: task.targetAgent,
          ...(targetAgent?.sessionName ? { sourceSessionName: targetAgent.sessionName } : {}),
          message: output,
        };
        const resultCommunications = [resultCommunication];
        this.options.publishEvent?.({
          type: "a2aCommunicationSummary",
          target: address.target,
          threadId: address.threadId,
          provider: this.options.provider,
          summaryId: a2aCommunicationGroupKey(resultCommunications),
          communications: resultCommunications,
        });
      }
      return {
        status,
        message: output || completion.error || (status === "COMPLETED" ? "Task completed without a text response." : "Provider task failed."),
      };
    } catch (error) {
      if (hasProviderFault(error)) throw error;
      throw providerFault(
        "PROVIDER_UNAVAILABLE",
        `${this.options.provider} A2A provider failed while ${providerStage}.`,
      );
    } finally {
      unsubscribe?.();
      if (!accepted) active.nativeFinished = true;
      if (executionAddress) {
        try {
          await this.options.sessions.deleteThread(executionAddress.target, executionAddress.threadId);
          this.ephemeralSessionIds.delete(encodeAddress(executionAddress));
        } catch {
          // Keep an undeleted task thread out of discovery for the rest of this process.
        }
        if (requiresFocusRestoreAfterDelete) {
          try {
            await this.options.conversations.openThread(address.target, address.threadId, { includeTranscript: false, minimal: true });
          } catch {
            // The task result remains valid if the provider cannot restore the original thread focus.
          }
        }
      }
      this.activeTasks.delete(task.taskId);
    }
  }

  private async copyTaskThreadSettings(
    session: NativeSession,
    address: SessionAddress,
    current: Awaited<ReturnType<ProviderConversationPort["openThread"]>>,
    created: Awaited<ReturnType<ProviderConversationPort["createThread"]>>,
    inherited: AgentPermissionProfile | undefined,
  ): Promise<void> {
    if (inherited && !this.canInheritPermissionProfile(session, inherited)) {
      throw providerFault("PERMISSION_DENIED", "The target provider cannot apply the caller's permission profile");
    }
    const permissionProfile = inherited?.profile ?? current.permissionProfile ?? undefined;
    if (current.permissionProfile && !inherited && this.options.isPermissionProfileSupported &&
        !this.options.isPermissionProfileSupported(current.permissionProfile)) {
      throw providerFault("PERMISSION_DENIED", "The target session's permission profile cannot be copied safely");
    }
    const update = {
      ...(current.model && current.model !== created.model ? { model: current.model } : {}),
      ...(current.reasoningEffort && current.reasoningEffort !== created.reasoningEffort ? { effort: current.reasoningEffort } : {}),
      ...(permissionProfile && permissionProfile !== created.permissionProfile ? { permissionProfile } : {}),
      ...(current.currentModeId && current.currentModeId !== created.currentModeId ? { modeId: current.currentModeId } : {}),
    };
    if (!Object.keys(update).length) return;
    if (!this.options.settings) {
      throw providerFault("PROVIDER_UNAVAILABLE", "The provider cannot copy the registered session settings to an isolated A2A session");
    }
    await this.options.settings.updateThreadSettings(address.target, address.threadId, update);
  }

  async cancel(session: NativeSession, taskId: string): Promise<void> {
    const active = this.activeTasks.get(taskId);
    if (!active) return;
    const address = decodeAddress(session, this.options.provider);
    if (!address || address.target !== active.ownerAddress.target || address.threadId !== active.ownerAddress.threadId) {
      throw providerFault("SESSION_NOT_FOUND", "The active A2A task session does not match the cancellation request");
    }
    active.cancelRequested = true;
    try {
      if (active.accepted && !active.turnId) {
        throw providerFault("CANCEL_UNSUPPORTED", "The provider did not expose a turn ID for cancellation");
      }
      if (active.turnId && active.address) {
        await this.options.turns.interruptTurn(active.address.target, active.address.threadId, active.turnId);
        active.nativeFinished = true;
      }
    } finally {
      active.resolveCancellation();
    }
  }

  private observeNativeTurn(event: AssistantEvent): void {
    if (event.provider !== this.options.provider) return;
    const key = encodeAddress({ target: event.target, threadId: event.threadId });
    if (event.type === "threadDeleted") {
      this.createdSessionIds.delete(key);
      return;
    }
    if (event.type === "turnStarted") {
      this.nativeTurns.set(key, event.turnId);
      return;
    }
    if (event.type !== "turnCompleted") return;
    const activeTurnId = this.nativeTurns.get(key);
    if (event.turnId && activeTurnId && event.turnId !== activeTurnId) return;
    this.nativeTurns.delete(key);
  }
}

export function encodeHiveSessionAddress(address: { target: string; threadId: string }): string {
  return encodeAddress(address);
}

export function decodeHiveSessionAddress(sessionId: string): HiveSessionAddress | undefined {
  if (!sessionId.startsWith("hive-session:v1:")) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(sessionId.slice("hive-session:v1:".length), "base64url").toString("utf8"));
    if (!isRecord(value) || typeof value.target !== "string" || !value.target.trim() ||
        typeof value.threadId !== "string" || !value.threadId.trim()) return undefined;
    return { target: value.target, threadId: value.threadId };
  } catch {
    return undefined;
  }
}

function encodeAddress(address: SessionAddress): string {
  return `hive-session:v1:${Buffer.from(JSON.stringify(address), "utf8").toString("base64url")}`;
}

function decodeAddress(session: NativeSession, provider: string): SessionAddress | undefined {
  if (session.provider !== provider || session.persistenceLevel !== 2 || session.runtimeManagedHistory ||
      !session.sessionId.startsWith("hive-session:v1:")) return undefined;
  return decodeHiveSessionAddress(session.sessionId);
}

function createActiveTask(ownerAddress: SessionAddress): ActiveTask {
  let resolveCompletion!: (value: TurnCompletion) => void;
  const completionPromise = new Promise<TurnCompletion>((resolve) => { resolveCompletion = resolve; });
  let resolveCancellation!: () => void;
  const cancellationPromise = new Promise<void>((resolve) => { resolveCancellation = resolve; });
  return {
    ownerAddress,
    messages: new Map(),
    accepted: false,
    cancelRequested: false,
    completionPromise,
    resolveCompletion,
    cancellationPromise,
    resolveCancellation,
    nativeFinished: false,
  };
}

function buildTaskPrompt(task: AgentTask, _context: AgentExecutionContext, message: string, canDelegate: boolean): string {
  const delivery = task.metadata?.delivery;
  const isResultCallback = delivery === "a2a-result-callback";
  const callbackForTaskId = typeof task.metadata?.callbackForTaskId === "string"
    ? task.metadata.callbackForTaskId
    : undefined;
  const lines = [
    "Handle one Hive A2A task in a fresh session. Use only this request as task context; read workspace files if more context is needed.",
    canDelegate
      ? `A2A tools are available. Your current Hive agent ID is ${task.targetAgent}; include it as callerAgentId in a2a_list_agents and a2a_send. Hive verifies it against the active task. Use a2a_list_agents only when needed. a2a_send returns an accepted taskId; call a2a_wait_task with that ID and repeat while completed is false to receive the actual result.`
      : "A2A tools are unavailable; complete the task directly.",
  ];
  if (isResultCallback && callbackForTaskId) {
    lines.push(`Result callback for ${callbackForTaskId}: give the original caller a useful summary. Do not send another callback.`);
  } else if (delivery === "a2a-async-request") {
    lines.push("Complete the requested work and return the actual result in this task response. For any delegated work, call a2a_send and then a2a_wait_task until it completes before incorporating the delegated result. Hive returns this task result to its caller through a2a_wait_task and a communication summary; do not send an acceptance-only callback.");
  }
  lines.push("", "Request:", message);
  return lines.join("\n");
}

function collectTurnOutput(
  messages: ReadonlyMap<string, string>,
): string {
  return [...messages.values()]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function normalizedTurnStatus(event: TurnCompletion): AgentResult["status"] {
  const status = event.status?.toLowerCase() ?? "completed";
  if (status.includes("cancel") || status.includes("interrupt")) return "CANCELLED";
  if (status.includes("fail") || status.includes("error")) return "FAILED";
  return "COMPLETED";
}

function cancelledResult(task: AgentTask): AgentResult {
  return { taskId: task.taskId, agentId: task.targetAgent, status: "CANCELLED", message: "Task was cancelled." };
}

function failedResult(task: AgentTask, code: string, message: string): AgentResult {
  return {
    taskId: task.taskId,
    agentId: task.targetAgent,
    status: "FAILED",
    message,
    metadata: { adapterErrorCode: code },
  };
}

function providerFault(code: string, message: string): Error & { code: string; provider: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, provider: "", retryable: code === "PROVIDER_UNAVAILABLE" });
}

function hasProviderFault(error: unknown): error is Error & { code: string; provider: string } {
  return typeof error === "object" && error !== null && "code" in error && "provider" in error &&
    typeof error.code === "string" && typeof error.provider === "string";
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("A2A task was cancelled");
}

function waitForCompletion(completion: Promise<TurnCompletion>, signal: AbortSignal): Promise<TurnCompletion> {
  if (signal.aborted) return Promise.reject(new Error("A2A task was cancelled"));
  return new Promise<TurnCompletion>((resolve, reject) => {
    const onAbort = (): void => reject(new Error("A2A task was cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    completion.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
