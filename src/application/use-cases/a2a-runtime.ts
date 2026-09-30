import {
  a2aCommunicationGroupKey,
  canTransitionAgent,
  canTransitionTask,
  DEFAULT_ROUTING_POLICY,
  type AdapterError,
  type AdapterErrorCode,
  type AgentHistoryEntry,
  type AgentInput,
  type AgentNode,
  type AgentPermissionProfile,
  type AgentResult,
  type AgentRoom,
  type AgentSelector,
  type AgentSummary,
  type AgentTask,
  type AgentTaskRecord,
  type A2ATaskSubmission,
  type NativeSession,
  type RoutingPolicy,
  type TaskState,
} from "../../domain/a2a.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { AssistantEvent, AssistantEventPublisher } from "../ports/events.js";
import type { A2ACommunicationClaim, A2APromptInboxPort, PendingA2ACommunication } from "../ports/a2a-prompt-inbox.js";
import type {
  A2ARuntimeEvent,
  A2ARuntimeEventHandler,
  A2ARuntimePort,
  A2ARuntimeStateStore,
  A2AWorkspaceLockPort,
  AgentAdapter,
  AgentAdapterDescriptor,
  AgentExecutionContext,
  AgentSessionToolRequest,
  A2ATaskWaitResult,
} from "../ports/a2a-runtime.js";
import {
  copyAgent,
  copyAgentSummary,
  copyDescriptor,
  copyEvent,
  copyRoom,
  copyTaskRecord,
  isNativeSession,
  isTerminalTask,
  normalizeAdapterError,
  parseAgentResult,
  raceWithAbort,
  requireNonEmpty,
  runtimeFault,
  sessionCapabilityError,
  uniqueStrings,
  validateAdapterDescriptor,
  validateNativeSession,
  validatePolicy,
  validateSnapshot,
  validateSubmission,
} from "../validation/a2a-runtime.js";

export type A2ARuntimeDependencies = {
  adapters: readonly AgentAdapter[];
  stateStore: A2ARuntimeStateStore;
  workspaceLocks: A2AWorkspaceLockPort;
  createId: (kind: "task" | "agent") => string;
  now: () => number;
  publishAssistantEvent?: AssistantEventPublisher;
  policy?: Partial<RoutingPolicy>;
};

export type RegisterAgentInput = {
  agentId: string;
  adapterId: string;
  session: NativeSession;
  role?: string;
  capabilities?: string[];
};

export type AgentProfileUpdate = {
  role?: string | null;
  capabilities?: string[];
};

export type SubmitAgentTaskInput = A2ATaskSubmission;

export type DiscoveryResult = {
  registered: AgentSummary[];
  skipped: Array<{ adapterId: string; code: AdapterErrorCode }>;
};

type TaskAncestry = {
  parent?: AgentTaskRecord;
  sourceAgent?: string;
  resolvedTargetAgent?: string;
  signal?: AbortSignal;
};

type ResolvedNativeCallerTarget = Pick<A2ATaskSubmission, "targetAgent" | "targetSessionName" | "selector"> & {
  resolvedTargetAgent?: string;
};

type ScheduledTask = {
  record: AgentTaskRecord;
  persisted: Promise<void>;
  completion?: Promise<AgentTaskRecord>;
};

type PromptClaimState = { agentId: string; provider: string; taskIds: string[]; key: string; observedTurnId?: string };
type InterpretationBinding = { taskIds: string[]; turnId?: string };
type PromptTurnCompletion = { turnId?: string; state: "COMPLETED" | "FAILED" | "CANCELLED"; message: string; error?: string };
const SESSION_DISCOVERY_TTL_MS = 15_000;

/** Coordinates rooms, routing, task lineage, session adapters, and per-session concurrency. */
export class A2ARuntime implements A2ARuntimePort, A2APromptInboxPort {
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly rooms = new Map<string, AgentRoom>();
  private readonly agents = new Map<string, AgentNode>();
  private readonly sessions = new Map<string, NativeSession>();
  private readonly histories = new Map<string, AgentHistoryEntry[]>();
  private readonly tasks = new Map<string, AgentTaskRecord>();
  private readonly listeners = new Set<A2ARuntimeEventHandler>();
  private readonly serialTails = new Map<string, Promise<void>>();
  private readonly activeTasks = new Map<string, Set<string>>();
  private readonly workspaceLockReleases = new Map<string, { release: (() => void) | undefined }>();
  private readonly waitingTasks = new Map<string, Set<string>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly pendingAsyncRequests = new Map<string, number>();
  private readonly pendingInterpretations = new Map<string, Set<string>>();
  private readonly taskResultSummaries = new Set<string>();
  private readonly activeTaskWaits = new Map<string, Set<string>>();
  private readonly promptClaims = new Map<string, PromptClaimState>();
  private readonly claimedInterpretations = new Map<string, string>();
  private readonly interpretationBindings = new Map<string, InterpretationBinding[]>();
  private readonly interpretationText = new Map<string, Map<string, string>>();
  private readonly earlyPromptCompletions = new Map<string, PromptTurnCompletion[]>();
  private promptClaimSequence = 0;
  private readonly sessionCreations = new Map<string, Promise<AgentNode>>();
  private readonly sessionDiscoveryInFlight = new Map<string, Promise<DiscoveryResult>>();
  private readonly sessionDiscoveryAt = new Map<string, number>();
  private readonly policy: RoutingPolicy;
  private initialized = false;
  private persistenceTail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: A2ARuntimeDependencies) {
    this.policy = { ...DEFAULT_ROUTING_POLICY, ...dependencies.policy };
    validatePolicy(this.policy);
    for (const adapter of dependencies.adapters) {
      const { adapterId } = adapter;
      if (!adapterId || this.adapters.has(adapterId)) throw new Error("A2A adapter IDs must be non-empty and unique");
      validateAdapterDescriptor(adapter);
      if (adapter.capabilities.attachExistingProcess && !adapter.attach) {
        throw new Error(`Adapter ${adapterId} declares process attachment without an attach operation`);
      }
      this.adapters.set(adapterId, adapter);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const snapshot = await this.dependencies.stateStore.load();
    validateSnapshot(snapshot);
    for (const room of snapshot.rooms) this.rooms.set(room.roomId, copyRoom(room));
    for (const agent of snapshot.agents) this.agents.set(agent.agentId, copyAgent(agent));
    for (const { agentId, session } of snapshot.sessions) this.sessions.set(agentId, { ...session });
    for (const { agentId, entries } of snapshot.histories) this.histories.set(agentId, entries.map((entry) => ({ ...entry })));
    for (const task of snapshot.tasks) {
      const restored = copyTaskRecord(task);
      const path = restored.task.visitedAgents;
      if (!restored.task.parentTaskId && restored.task.depth === 0 && restored.task.sourceAgent !== "orchestrator" &&
          path.length === 2 && path[0] === restored.task.sourceAgent && path[1] === restored.task.targetAgent) {
        restored.task.visitedAgents = [restored.task.targetAgent];
      }
      this.tasks.set(restored.task.taskId, restored);
    }
    let recovered = false;
    for (const agent of this.agents.values()) {
      const adapter = this.adapters.get(agent.adapterId);
      agent.state = "OFFLINE";
      agent.offlineReason = adapter ? "SESSION_UNAVAILABLE" : "ADAPTER_UNAVAILABLE";
      delete agent.currentTaskId;
      recovered = true;
    }
    for (const task of this.tasks.values()) {
      if (!isTerminalTask(task.state)) {
        task.state = "FAILED";
        task.updatedAt = this.readClock();
        task.error = runtimeFault("PROCESS_EXITED", this.agents.get(task.task.targetAgent)?.provider ?? "", "Runtime restarted before this task completed", true).detail;
        recovered = true;
      }
    }
    this.initialized = true;
    if (recovered) await this.persist();
  }

  subscribe(handler: A2ARuntimeEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  listAdapters(): AgentAdapterDescriptor[] {
    return [...this.adapters.values()].map((adapter) => copyDescriptor(adapter));
  }

  async ensureSessionsDiscovered(roomId: string): Promise<void> {
    this.assertInitialized();
    this.requireRoom(roomId);
    const lastDiscovery = this.sessionDiscoveryAt.get(roomId);
    const now = this.readClock();
    if (lastDiscovery !== undefined && now >= lastDiscovery && now - lastDiscovery < SESSION_DISCOVERY_TTL_MS) return;
    await this.discoverSessions(roomId);
  }

  listRooms(): AgentRoom[] {
    this.assertInitialized();
    return [...this.rooms.values()].map(copyRoom);
  }

  listAgents(roomId: string): AgentSummary[] {
    this.assertInitialized();
    const room = this.requireRoom(roomId);
    return room.agentIds.flatMap((agentId) => {
      const agent = this.agents.get(agentId);
      return agent ? [copyAgentSummary(agent)] : [];
    });
  }

  listAgentsForAgent(agentId: string): AgentSummary[] {
    this.assertInitialized();
    const room = [...this.rooms.values()].find((candidate) => candidate.agentIds.includes(agentId));
    if (!room) throw runtimeFault("INVALID_REQUEST", "", "Agent is not registered in a room");
    return this.listAgents(room.roomId);
  }

  findAgentForNativeSession(provider: string, nativeSessionId: string): AgentSummary | undefined {
    this.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(nativeSessionId, "nativeSessionId");
    const matches = [...this.agents.values()].filter((agent) => {
      if (agent.provider !== provider) return false;
      const session = this.sessions.get(agent.agentId);
      if (!session) return false;
      const adapter = this.adapters.get(agent.adapterId);
      return adapter?.matchesNativeSession?.(session, nativeSessionId) ?? session.sessionId === nativeSessionId;
    });
    if (matches.length !== 1) return undefined;
    return copyAgentSummary(matches[0]!);
  }

  async resolveNativeSessionAgent(provider: string, nativeSessionId: string): Promise<AgentSummary | undefined> {
    this.assertInitialized();
    let agent = this.findAgentForNativeSession(provider, nativeSessionId);
    if (agent) return agent;
    for (const room of this.rooms.values()) {
      await this.ensureSessionsDiscovered(room.roomId);
      agent = this.findAgentForNativeSession(provider, nativeSessionId);
      if (agent) return agent;
    }
    return undefined;
  }

  async findActiveAgentForTarget(provider: string, target: string): Promise<AgentSummary | undefined> {
    this.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(target, "target");
    const matches: AgentNode[] = [];
    for (const agent of this.agents.values()) {
      if (agent.provider !== provider) continue;
      const session = this.sessions.get(agent.agentId);
      const adapter = this.adapters.get(agent.adapterId);
      if (!session || !adapter || (adapter.matchesNativeTarget && !adapter.matchesNativeTarget(session, target))) continue;
      const hasActiveRuntimeTask = [...(this.activeTasks.get(agent.agentId) ?? [])].some((taskId) => {
        const task = this.tasks.get(taskId);
        return task?.state === "RUNNING" || task?.state === "WAITING";
      });
      if (hasActiveRuntimeTask) {
        matches.push(agent);
        continue;
      }
      if (this.pendingAsyncRequests.has(agent.agentId) || !adapter.isBusy) continue;
      if (await adapter.isBusy(session)) matches.push(agent);
    }
    if (matches.length !== 1) return undefined;
    return copyAgentSummary(matches[0]!);
  }

  async resolveActiveAgentForTarget(provider: string, target: string): Promise<AgentSummary | undefined> {
    let agent = await this.findActiveAgentForTarget(provider, target);
    if (agent) return agent;
    for (const room of this.rooms.values()) {
      await this.ensureSessionsDiscovered(room.roomId);
      agent = await this.findActiveAgentForTarget(provider, target);
      if (agent) return agent;
    }
    return undefined;
  }

  async resolveActiveAgentForTask(provider: string, agentId: string): Promise<AgentSummary | undefined> {
    this.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(agentId, "agentId");
    const agent = this.agents.get(agentId);
    const session = this.sessions.get(agentId);
    const adapter = agent ? this.adapters.get(agent.adapterId) : undefined;
    if (!agent || agent.provider !== provider || !session || !adapter) return undefined;
    const activeTasks = [...(this.activeTasks.get(agentId) ?? [])].filter((taskId) => {
      const task = this.tasks.get(taskId);
      return task?.state === "RUNNING" || task?.state === "WAITING";
    });
    if (activeTasks.length !== 1) return undefined;
    return copyAgentSummary(agent);
  }

  async sendFromNativeSession(provider: string, nativeSessionId: string, input: AgentSessionToolRequest): Promise<AgentTaskRecord> {
    this.assertInitialized();
    const source = await this.resolveNativeSessionAgent(provider, nativeSessionId);
    if (!source) throw runtimeFault("SESSION_NOT_FOUND", provider, "Calling native session is not registered in a Hive room");
    const parent = this.findActiveParentTask(source.agentId, nativeSessionId);
    return this.sendFromAgentWithParent(source.agentId, input, parent);
  }

  async sendFromActiveSession(provider: string, target: string, input: AgentSessionToolRequest): Promise<AgentTaskRecord> {
    this.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(target, "target");
    const source = await this.findActiveAgentForTarget(provider, target);
    if (!source) {
      throw runtimeFault("INVALID_REQUEST", provider, "Could not uniquely identify the active session for this provider target");
    }
    return this.sendFromAgentWithParent(source.agentId, input, this.findActiveParentTask(source.agentId));
  }

  async sendFromAgent(agentId: string, input: AgentSessionToolRequest): Promise<AgentTaskRecord> {
    return this.sendFromAgentWithParent(agentId, input, this.findActiveParentTask(agentId));
  }

  private async sendFromAgentWithParent(
    agentId: string,
    input: AgentSessionToolRequest,
    parent: AgentTaskRecord | undefined,
  ): Promise<AgentTaskRecord> {
    this.assertInitialized();
    const source = this.agents.get(agentId);
    if (!source) throw runtimeFault("INVALID_REQUEST", "", "Calling agent is not registered");
    const adapter = this.requireAdapter(source.adapterId);
    const session = this.sessions.get(agentId);
    if (!adapter.capabilities.delegation || !session || (adapter.canDelegate && !adapter.canDelegate(session))) {
      throw runtimeFault("PERMISSION_DENIED", source.provider, "This session adapter does not expose A2A tools");
    }
    const room = [...this.rooms.values()].find((candidate) => candidate.agentIds.includes(agentId));
    if (!room) throw runtimeFault("INVALID_REQUEST", source.provider, "Calling agent is not registered in a room");
    this.validateNativeTargetRequest(input, source.provider);
    const callbackForTaskId = input.callbackForTaskId;
    let metadata: Record<string, unknown>;
    let targetInput = input;
    if (callbackForTaskId !== undefined) {
      requireNonEmpty(callbackForTaskId, "callbackForTaskId");
      const original = this.tasks.get(callbackForTaskId);
      if (!original || original.task.metadata?.delivery !== "a2a-async-request" ||
          original.task.targetAgent !== agentId || original.task.sourceAgent === "orchestrator" ||
          original.task.roomId !== room.roomId) {
        throw runtimeFault("INVALID_REQUEST", source.provider, "callbackForTaskId does not identify an async request assigned to this agent");
      }
      if (input.targetAgent !== original.task.sourceAgent || input.targetSessionName !== undefined || input.selector !== undefined) {
        throw runtimeFault("INVALID_REQUEST", source.provider, "A result callback must target the original calling agent by ID");
      }
      if ([...this.tasks.values()].some((record) => record.task.metadata?.callbackForTaskId === callbackForTaskId)) {
        throw runtimeFault("INVALID_REQUEST", source.provider, "A result callback was already submitted for this request");
      }
      targetInput = {
        ...input,
        targetAgent: original.task.sourceAgent,
        message: ["Original request:", original.task.message, "Result:", input.message].join("\n\n"),
      };
      metadata = { delivery: "a2a-result-callback", callbackForTaskId };
    } else {
      metadata = { delivery: "a2a-async-request" };
    }
    const target = await this.resolveNativeCallerTarget(source, session, room, targetInput, [agentId]);
    const { resolvedTargetAgent, ...submissionTarget } = target;
    if (callbackForTaskId !== undefined) {
      const recipient = resolvedTargetAgent ? this.agents.get(resolvedTargetAgent) : undefined;
      const recipientSession = recipient ? this.sessions.get(recipient.agentId) : undefined;
      const recipientAdapter = recipient ? this.adapters.get(recipient.adapterId) : undefined;
      if (!recipient || !recipientSession || !recipientAdapter?.getPromptAddress?.(recipientSession)) {
        throw runtimeFault("INVALID_REQUEST", source.provider, "The original caller cannot receive hidden A2A communication summaries");
      }
    }
    const parentController = parent ? this.abortControllers.get(parent.task.taskId) : undefined;
    const scheduled = this.createScheduledTask({
      roomId: room.roomId,
      ...submissionTarget,
      message: targetInput.message,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      metadata,
    }, {
      sourceAgent: agentId,
      ...(parent ? { parent } : {}),
      ...(parentController ? { signal: parentController.signal } : {}),
      ...(resolvedTargetAgent ? { resolvedTargetAgent } : {}),
    }, callbackForTaskId !== undefined);
    if (parentController && scheduled.completion) {
      const cancelChild = (): void => { void this.cancelTask(scheduled.record.task.taskId).catch(() => undefined); };
      parentController.signal.addEventListener("abort", cancelChild, { once: true });
      if (parentController.signal.aborted) cancelChild();
      void scheduled.completion.finally(() => parentController.signal.removeEventListener("abort", cancelChild)).catch(() => undefined);
    }
    const releasePendingRequest = callbackForTaskId === undefined
      ? this.trackPendingAsyncRequest(source.agentId)
      : undefined;
    if (releasePendingRequest && scheduled.completion) void scheduled.completion.then(releasePendingRequest, releasePendingRequest);
    await scheduled.persisted;
    if (scheduled.completion) void scheduled.completion.catch(() => undefined);
    else {
      const pending = this.pendingInterpretations.get(scheduled.record.task.targetAgent) ?? new Set<string>();
      pending.add(scheduled.record.task.taskId);
      this.pendingInterpretations.set(scheduled.record.task.targetAgent, pending);
    }
    return copyTaskRecord(scheduled.record);
  }

  async claimForPrompt(provider: string, target: string, threadId: string): Promise<A2ACommunicationClaim | undefined> {
    this.assertInitialized();
    const matches = [...this.agents.values()].filter((agent) => {
      if (agent.provider !== provider) return false;
      const session = this.sessions.get(agent.agentId);
      const adapter = this.adapters.get(agent.adapterId);
      return Boolean(session && adapter?.matchesNativeSession?.(session, threadId) &&
        (!adapter.matchesNativeTarget || adapter.matchesNativeTarget(session, target)));
    });
    if (matches.length !== 1) return undefined;
    const agent = matches[0]!;
    const taskIds = [...(this.pendingInterpretations.get(agent.agentId) ?? [])]
      .filter((taskId) => !this.claimedInterpretations.has(taskId) && this.tasks.get(taskId)?.state === "QUEUED")
      .sort((leftId, rightId) => {
        const left = this.tasks.get(leftId)?.task;
        const right = this.tasks.get(rightId)?.task;
        return (left?.createdAt ?? 0) - (right?.createdAt ?? 0) || leftId.localeCompare(rightId);
      });
    if (!taskIds.length) return undefined;
    this.promptClaimSequence += 1;
    const claimId = `a2a-prompt-${this.promptClaimSequence}-${taskIds[0]}`;
    const key = interpretationKey(provider, target, threadId);
    this.promptClaims.set(claimId, { agentId: agent.agentId, provider, taskIds, key });
    for (const taskId of taskIds) this.claimedInterpretations.set(taskId, claimId);
    const communications: PendingA2ACommunication[] = taskIds.flatMap((taskId) => {
      const record = this.tasks.get(taskId);
      if (!record) return [];
      const source = this.agents.get(record.task.sourceAgent);
      return [{
        kind: "result",
        taskId,
        sourceAgentId: record.task.sourceAgent,
        ...(source?.sessionName ? { sourceSessionName: source.sessionName } : {}),
        message: record.task.message,
      }];
    });
    return { claimId, communications };
  }

  async acceptPromptClaim(claimId: string, turnId?: string): Promise<void> {
    this.assertInitialized();
    const claim = this.promptClaims.get(claimId);
    if (!claim) return;
    this.promptClaims.delete(claimId);
    for (const taskId of claim.taskIds) {
      this.claimedInterpretations.delete(taskId);
      const record = this.tasks.get(taskId);
      if (!record || record.state !== "QUEUED") continue;
      this.removePendingInterpretation(record.task.targetAgent, taskId);
      this.transitionTask(record, "RUNNING");
    }
    const records = claim.taskIds.filter((taskId) => this.tasks.get(taskId)?.state === "RUNNING");
    if (records.length) {
      const bindings = this.interpretationBindings.get(claim.key) ?? [];
      const acceptedTurnId = turnId ?? claim.observedTurnId;
      const binding = { taskIds: records, ...(acceptedTurnId ? { turnId: acceptedTurnId } : {}) };
      bindings.push(binding);
      this.interpretationBindings.set(claim.key, bindings);
      const completions = this.earlyPromptCompletions.get(claim.key) ?? [];
      const completionIndex = completions.findIndex((completion) => acceptedTurnId ? completion.turnId === acceptedTurnId : !completion.turnId);
      if (completionIndex >= 0) {
        const [completion] = completions.splice(completionIndex, 1);
        if (completions.length) this.earlyPromptCompletions.set(claim.key, completions);
        else this.earlyPromptCompletions.delete(claim.key);
        this.removeInterpretationBinding(claim.key, binding);
        this.completeInterpretationTasks(records, claim.provider, completion!.state, completion!.message, completion!.error);
      }
      await this.persist();
    }
  }

  async releasePromptClaim(claimId: string): Promise<void> {
    const claim = this.promptClaims.get(claimId);
    if (!claim) return;
    this.promptClaims.delete(claimId);
    for (const taskId of claim.taskIds) this.claimedInterpretations.delete(taskId);
    if (!this.interpretationBindings.has(claim.key)) this.earlyPromptCompletions.delete(claim.key);
  }

  /** Completes queued A2A callbacks when the provider turn that carried them finishes. */
  observeProviderEvent(event: AssistantEvent): void {
    if (!this.initialized || !event.provider || !event.threadId || !event.target) return;
    const key = interpretationKey(event.provider, event.target, event.threadId);
    if (event.type === "turnStarted") {
      if (event.turnId) {
        for (const claim of this.promptClaims.values()) {
          if (claim.key === key) claim.observedTurnId = event.turnId;
        }
      }
      return;
    }
    if (event.type === "assistantDelta" || event.type === "assistantMessageCompleted") {
      if (!event.turnId) return;
      const claimed = [...this.promptClaims.values()].some((claim) => claim.key === key);
      if (!claimed && !this.interpretationBindings.has(key)) return;
      const textKey = `${key}\u0000${event.turnId}`;
      const messages = this.interpretationText.get(textKey) ?? new Map<string, string>();
      if (event.type === "assistantDelta") messages.set(event.messageId, `${messages.get(event.messageId) ?? ""}${event.text}`);
      else messages.set(event.messageId, event.text);
      this.interpretationText.set(textKey, messages);
      return;
    }
    if (event.type !== "turnCompleted") return;
    const bindings = this.interpretationBindings.get(key);
    const textKey = event.turnId ? `${key}\u0000${event.turnId}` : undefined;
    const interpretedMessage = textKey
      ? [...(this.interpretationText.get(textKey)?.values() ?? [])].map((text) => text.trim()).filter(Boolean).join("\n\n")
      : "";
    if (textKey) this.interpretationText.delete(textKey);
    const providerStatus = (event.status ?? "completed").toLowerCase();
    const state: PromptTurnCompletion["state"] =
      providerStatus.includes("cancel") || providerStatus.includes("interrupt") ? "CANCELLED"
        : providerStatus.includes("fail") || providerStatus.includes("error") ? "FAILED" : "COMPLETED";
    const message = interpretedMessage || event.error ||
      (state === "COMPLETED" ? "A2A communication was delivered for interpretation." : "The provider could not interpret the A2A communication.");
    const matched = (bindings ?? []).filter((binding) => !binding.turnId || !event.turnId || binding.turnId === event.turnId);
    if (!matched.length) {
      if ([...this.promptClaims.values()].some((claim) => claim.key === key)) {
        const completions = this.earlyPromptCompletions.get(key) ?? [];
        completions.push({ ...(event.turnId ? { turnId: event.turnId } : {}), state, message, ...(event.error ? { error: event.error } : {}) });
        if (completions.length > 8) completions.shift();
        this.earlyPromptCompletions.set(key, completions);
      }
      return;
    }
    const remaining = (bindings ?? []).filter((binding) => !matched.includes(binding));
    if (remaining.length) this.interpretationBindings.set(key, remaining);
    else this.interpretationBindings.delete(key);
    for (const binding of matched) this.completeInterpretationTasks(binding.taskIds, event.provider, state, message, event.error);
    void this.persist().catch(() => undefined);
  }

  private trackPendingAsyncRequest(agentId: string): () => void {
    this.pendingAsyncRequests.set(agentId, (this.pendingAsyncRequests.get(agentId) ?? 0) + 1);
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      const count = (this.pendingAsyncRequests.get(agentId) ?? 1) - 1;
      if (count > 0) this.pendingAsyncRequests.set(agentId, count);
      else this.pendingAsyncRequests.delete(agentId);
    };
  }

  private findActiveParentTask(agentId: string, nativeSessionId?: string): AgentTaskRecord | undefined {
    const session = this.sessions.get(agentId);
    const adapter = this.agents.get(agentId) ? this.adapters.get(this.agents.get(agentId)!.adapterId) : undefined;
    if (nativeSessionId && session && adapter?.getActiveTaskIdForSession) {
      const taskId = adapter.getActiveTaskIdForSession(session, nativeSessionId);
      const task = taskId ? this.tasks.get(taskId) : undefined;
      return task && (task.state === "RUNNING" || task.state === "WAITING") ? task : undefined;
    }
    const candidates = [...(this.activeTasks.get(agentId) ?? [])]
      .map((taskId) => this.tasks.get(taskId))
      .filter((task): task is AgentTaskRecord => task !== undefined && (task.state === "RUNNING" || task.state === "WAITING"));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  private removePendingInterpretation(agentId: string, taskId: string): void {
    const pending = this.pendingInterpretations.get(agentId);
    pending?.delete(taskId);
    if (pending?.size === 0) this.pendingInterpretations.delete(agentId);
  }

  private removeInterpretationBinding(key: string, bindingToRemove: InterpretationBinding): void {
    const bindings = this.interpretationBindings.get(key) ?? [];
    const remaining = bindings.filter((binding) => binding !== bindingToRemove);
    if (remaining.length) this.interpretationBindings.set(key, remaining);
    else this.interpretationBindings.delete(key);
  }

  private completeInterpretationTasks(
    taskIds: string[],
    provider: string,
    state: PromptTurnCompletion["state"],
    message: string,
    error?: string,
  ): void {
    for (const taskId of taskIds) {
      const record = this.tasks.get(taskId);
      if (!record || record.state !== "RUNNING") continue;
      record.result = { taskId, agentId: record.task.targetAgent, status: state, message };
      if (state === "FAILED") record.error = runtimeFault("PROCESS_EXITED", provider, error ?? "Provider turn failed while interpreting A2A communication", true).detail;
      this.transitionTask(record, state);
    }
  }

  getTask(taskId: string): AgentTaskRecord | undefined {
    this.assertInitialized();
    const task = this.tasks.get(taskId);
    return task ? copyTaskRecord(task) : undefined;
  }

  async waitForTask(taskId: string, waitMs = 20_000): Promise<A2ATaskWaitResult> {
    this.assertInitialized();
    requireNonEmpty(taskId, "taskId");
    if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 30_000) {
      throw runtimeFault("INVALID_REQUEST", "", "waitMs must be an integer from 1 to 30000");
    }
    let record = this.tasks.get(taskId);
    if (!record) throw runtimeFault("INVALID_REQUEST", "", "Task does not exist");
    if (isTerminalTask(record.state)) return toTaskWaitResult(record);

    const parentTaskId = record.task.parentTaskId;
    const parent = parentTaskId ? this.tasks.get(parentTaskId) : undefined;
    if (parent && (parent.state === "RUNNING" || parent.state === "WAITING")) {
      const waiters = this.activeTaskWaits.get(parentTaskId!) ?? new Set<string>();
      waiters.add(taskId);
      this.activeTaskWaits.set(parentTaskId!, waiters);
      if (waiters.size === 1 && parent.state === "RUNNING") {
        this.addWaiting(parent.task.targetAgent, parent.task.taskId);
        this.transitionTask(parent, "WAITING");
        const workspaceLock = this.workspaceLockReleases.get(parent.task.taskId);
        workspaceLock?.release?.();
        if (workspaceLock) workspaceLock.release = undefined;
        const parentAgent = this.agents.get(parent.task.targetAgent);
        if (parentAgent) this.setDerivedAgentState(parentAgent);
        await this.persist();
      }
    }
    try {
      await new Promise<void>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe = (): void => undefined;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          unsubscribe();
          resolve();
        };
        unsubscribe = this.subscribe((event) => {
          if (event.type !== "task.updated" || event.task.task.taskId !== taskId || !isTerminalTask(event.task.state)) return;
          finish();
        });
        timer = setTimeout(finish, waitMs);
        record = this.tasks.get(taskId);
        if (record && isTerminalTask(record.state)) finish();
      });
    } finally {
      if (parentTaskId) {
        const waiters = this.activeTaskWaits.get(parentTaskId);
        waiters?.delete(taskId);
        if (waiters?.size === 0) {
          this.activeTaskWaits.delete(parentTaskId);
          const currentParent = this.tasks.get(parentTaskId);
          const parentAgent = currentParent ? this.agents.get(currentParent.task.targetAgent) : undefined;
          const parentController = this.abortControllers.get(parentTaskId);
          if (currentParent?.state === "WAITING" && parentAgent?.workspace && parentController && !parentController.signal.aborted) {
            const remaining = currentParent.task.timeoutMs - Math.max(0, this.readClock() - currentParent.task.createdAt);
            if (remaining > 0) {
              try {
                const release = await raceWithAbort(
                  this.dependencies.workspaceLocks.acquire(parentAgent.workspace, parentController.signal),
                  parentController.signal,
                  () => false,
                );
                const workspaceLock = this.workspaceLockReleases.get(parentTaskId);
                if (workspaceLock) workspaceLock.release = release;
                else this.workspaceLockReleases.set(parentTaskId, { release });
              } catch {
                // Parent cancellation or timeout takes precedence over reacquiring its workspace.
              }
            }
          }
          if (currentParent && currentParent.state === "WAITING") {
            this.removeWaiting(currentParent.task.targetAgent, currentParent.task.taskId);
            if (!parentController?.signal.aborted && (!parentAgent?.workspace || this.workspaceLockReleases.get(parentTaskId)?.release)) {
              this.transitionTask(currentParent, "RUNNING");
              if (parentAgent) this.setDerivedAgentState(parentAgent);
            }
            await this.persist();
          }
        }
      }
    }
    record = this.tasks.get(taskId);
    if (!record) throw runtimeFault("INVALID_REQUEST", "", "Task does not exist");
    return toTaskWaitResult(record);
  }

  getTaskGraph(rootTaskId: string): AgentTaskRecord[] {
    this.assertInitialized();
    return [...this.tasks.values()]
      .filter(({ task }) => task.rootTaskId === rootTaskId)
      .sort((left, right) => left.task.createdAt - right.task.createdAt || left.task.taskId.localeCompare(right.task.taskId))
      .map(copyTaskRecord);
  }

  async createRoom(roomId: string, name: string): Promise<AgentRoom> {
    this.assertInitialized();
    requireNonEmpty(roomId, "roomId");
    requireNonEmpty(name, "name");
    if (this.rooms.has(roomId)) throw runtimeFault("INVALID_REQUEST", "", "Room already exists");
    const room: AgentRoom = { roomId, name, agentIds: [], createdAt: this.readClock() };
    this.rooms.set(roomId, room);
    await this.persist();
    this.emit({ type: "room.updated", room });
    return copyRoom(room);
  }

  async registerAgent(roomId: string, input: RegisterAgentInput): Promise<AgentNode> {
    this.assertInitialized();
    const room = this.requireRoom(roomId);
    const adapter = this.requireAdapter(input.adapterId);
    validateNativeSession(input.session);
    if (input.session.provider !== adapter.provider) {
      throw runtimeFault("INVALID_REQUEST", adapter.provider, "Session provider does not match its adapter");
    }
    const unsupported = sessionCapabilityError(input.session, adapter);
    if (unsupported) throw runtimeFault(unsupported, adapter.provider, "Adapter does not declare the session capability required by this persistence level");
    requireNonEmpty(input.agentId, "agentId");
    if (this.agents.has(input.agentId)) throw runtimeFault("INVALID_REQUEST", adapter.provider, "Agent already exists");
    if ([...this.sessions.values()].some((session) => session.sessionId === input.session.sessionId && session.provider === input.session.provider)) {
      throw runtimeFault("INVALID_REQUEST", adapter.provider, "Native session is already registered");
    }

    let state: AgentNode["state"] = "IDLE";
    let offlineReason: AgentNode["offlineReason"];
    try {
      if (!(await adapter.isAvailable(input.session))) {
        state = "OFFLINE";
        offlineReason = "SESSION_UNAVAILABLE";
      }
    } catch {
      state = "OFFLINE";
      offlineReason = "ADAPTER_UNAVAILABLE";
    }

    const agent: AgentNode = {
      agentId: input.agentId,
      provider: input.session.provider,
      adapterId: input.adapterId,
      nativeSessionId: input.session.sessionId,
      state,
      lastActivityAt: this.readClock(),
      capabilities: uniqueStrings(input.capabilities ?? []),
      ...(input.role ? { role: input.role } : {}),
      ...(input.session.sessionName?.trim() ? { sessionName: input.session.sessionName.trim() } : {}),
      ...(input.session.workspace ? { workspace: input.session.workspace } : {}),
      ...(offlineReason ? { offlineReason } : {}),
    };
    this.agents.set(agent.agentId, agent);
    this.sessions.set(agent.agentId, { ...input.session });
    room.agentIds.push(agent.agentId);
    await this.persist();
    this.emit({ type: "room.updated", room });
    this.emit({ type: "agent.updated", agent: copyAgentSummary(agent) });
    return copyAgent(agent);
  }

  async updateAgentProfile(agentId: string, update: AgentProfileUpdate): Promise<AgentSummary> {
    this.assertInitialized();
    const agent = this.agents.get(agentId);
    if (!agent) throw runtimeFault("INVALID_REQUEST", "", "Agent does not exist");
    if (update.role !== undefined && update.role !== null) requireNonEmpty(update.role, "role");
    if (update.capabilities !== undefined &&
        (!Array.isArray(update.capabilities) || update.capabilities.some((capability) => typeof capability !== "string" || !capability.trim()))) {
      throw runtimeFault("INVALID_REQUEST", agent.provider, "Agent capabilities must be non-empty strings");
    }
    if (update.role !== undefined) {
      if (update.role === null) delete agent.role;
      else agent.role = update.role;
    }
    if (update.capabilities !== undefined) {
      agent.capabilities = uniqueStrings(update.capabilities);
    }
    agent.lastActivityAt = this.readClock();
    await this.persist();
    this.emit({ type: "agent.updated", agent: copyAgentSummary(agent) });
    return copyAgentSummary(agent);
  }

  async discoverSessions(roomId: string, adapterId?: string): Promise<DiscoveryResult> {
    this.assertInitialized();
    this.requireRoom(roomId);
    const key = adapterId ? `${roomId}\u0000${adapterId}` : roomId;
    const existing = this.sessionDiscoveryInFlight.get(key);
    if (existing) return existing;
    const discovery = this.discoverSessionsNow(roomId, adapterId);
    this.sessionDiscoveryInFlight.set(key, discovery);
    try {
      const result = await discovery;
      if (!adapterId) this.sessionDiscoveryAt.set(roomId, this.readClock());
      return result;
    } finally {
      if (this.sessionDiscoveryInFlight.get(key) === discovery) this.sessionDiscoveryInFlight.delete(key);
    }
  }

  private async discoverSessionsNow(roomId: string, adapterId?: string): Promise<DiscoveryResult> {
    const adapters = adapterId ? [this.requireAdapter(adapterId)] : [...this.adapters.values()];
    const registered: AgentSummary[] = [];
    const skipped: DiscoveryResult["skipped"] = [];
    for (const adapter of adapters) {
      const descriptor = adapter;
      if (!descriptor.capabilities.discoverSessions || descriptor.integrationStatus === "UNAVAILABLE" ||
          descriptor.integrationStatus === "MANUAL_CONFIGURATION_REQUIRED") {
        skipped.push({ adapterId: descriptor.adapterId, code: "UNVERIFIED_INTEGRATION" });
        continue;
      }
      let sessions: NativeSession[];
      try {
        sessions = await adapter.discoverSessions();
        for (const code of adapter.getDiscoveryFailures?.() ?? []) skipped.push({ adapterId: descriptor.adapterId, code });
      } catch {
        skipped.push({ adapterId: descriptor.adapterId, code: "PROVIDER_UNAVAILABLE" });
        continue;
      }
      for (const candidate of sessions) {
        if (!isNativeSession(candidate) || candidate.provider !== descriptor.provider) {
          skipped.push({ adapterId: descriptor.adapterId, code: "UNVERIFIED_INTEGRATION" });
          continue;
        }
        const unsupported = sessionCapabilityError(candidate, descriptor);
        if (unsupported) {
          skipped.push({ adapterId: descriptor.adapterId, code: unsupported });
          continue;
        }
        const existing = [...this.agents.values()].find((agent) =>
          agent.adapterId === descriptor.adapterId && agent.nativeSessionId === candidate.sessionId,
        );
        if (existing) {
          let profileUpdated = false;
          const existingSession = this.sessions.get(existing.agentId);
          const sessionName = candidate.sessionName?.trim();
          if (sessionName && existing.sessionName !== sessionName) {
            existing.sessionName = sessionName;
            profileUpdated = true;
          }
          if (candidate.workspace && existing.workspace !== candidate.workspace) {
            existing.workspace = candidate.workspace;
            profileUpdated = true;
          }
          if (existingSession && profileUpdated) {
            this.sessions.set(existing.agentId, {
              ...existingSession,
              ...candidate,
              ...(sessionName ? { sessionName } : existingSession.sessionName ? { sessionName: existingSession.sessionName } : {}),
              ...(candidate.workspace ? { workspace: candidate.workspace } : existingSession.workspace ? { workspace: existingSession.workspace } : {}),
            });
          }
          const room = this.requireRoom(roomId);
          if (!room.agentIds.includes(existing.agentId)) {
            room.agentIds.push(existing.agentId);
            await this.persist();
            this.emit({ type: "room.updated", room });
          } else if (profileUpdated) {
            existing.lastActivityAt = this.readClock();
            await this.persist();
            this.emit({ type: "agent.updated", agent: copyAgentSummary(existing) });
          }
          registered.push(copyAgentSummary(existing));
          continue;
        }
        const agentId = this.dependencies.createId("agent");
        if (typeof agentId !== "string" || !agentId || this.agents.has(agentId)) {
          skipped.push({ adapterId: descriptor.adapterId, code: "INVALID_REQUEST" });
          continue;
        }
        try {
          const agent = await this.registerAgent(roomId, { agentId, adapterId: descriptor.adapterId, session: candidate });
          registered.push(copyAgentSummary(agent));
        } catch {
          skipped.push({ adapterId: descriptor.adapterId, code: "PROVIDER_UNAVAILABLE" });
        }
      }
    }
    return { registered, skipped };
  }

  async refreshAvailability(roomId: string): Promise<AgentSummary[]> {
    this.assertInitialized();
    const room = this.requireRoom(roomId);
    for (const agentId of room.agentIds) {
      const agent = this.agents.get(agentId);
      if (!agent || agent.state === "WORKING" || agent.state === "WAITING") continue;
      const session = this.sessions.get(agentId);
      const adapter = this.adapters.get(agent.adapterId);
      if (!session) continue;
      if (!adapter) {
        this.setAgentState(agent, "OFFLINE", "ADAPTER_UNAVAILABLE");
        continue;
      }
      try {
        if (!(await adapter.isAvailable(session))) {
          this.setAgentState(agent, "OFFLINE", "SESSION_UNAVAILABLE");
          continue;
        }
        if (await adapter.isBusy?.(session)) {
          if (agent.state === "ERROR") continue;
          if (agent.state === "OFFLINE") this.setAgentState(agent, "IDLE");
          this.setAgentState(agent, "WORKING");
          continue;
        }
        this.setAgentState(agent, "IDLE");
      } catch {
        this.setAgentState(agent, "OFFLINE", "ADAPTER_UNAVAILABLE");
      }
    }
    await this.persist();
    return this.listAgents(roomId);
  }

  async submitTask(input: SubmitAgentTaskInput): Promise<AgentTaskRecord> {
    this.assertInitialized();
    return this.createScheduledTask(input, {}).completion!;
  }

  async enqueueTask(input: SubmitAgentTaskInput): Promise<AgentTaskRecord> {
    this.assertInitialized();
    const scheduled = this.createScheduledTask(input, {});
    await scheduled.persisted;
    void scheduled.completion!.catch(() => undefined);
    return copyTaskRecord(scheduled.record);
  }

  async cancelTask(taskId: string): Promise<AgentTaskRecord> {
    this.assertInitialized();
    const record = this.tasks.get(taskId);
    if (!record) throw runtimeFault("INVALID_REQUEST", "", "Task does not exist");
    if (record.state === "QUEUED") {
      this.abortControllers.get(taskId)?.abort();
      this.removePendingInterpretation(record.task.targetAgent, taskId);
      this.transitionTask(record, "CANCELLED");
      await this.persist();
      return copyTaskRecord(record);
    }
    if (record.state !== "RUNNING" && record.state !== "WAITING") return copyTaskRecord(record);

    const agent = this.agents.get(record.task.targetAgent);
    const session = this.sessions.get(record.task.targetAgent);
    const adapter = agent ? this.adapters.get(agent.adapterId) : undefined;
    if (!agent || !session || !adapter) throw runtimeFault("PROVIDER_UNAVAILABLE", agent?.provider ?? "", "Agent adapter is unavailable");
    if (!adapter.capabilities.cancellation) {
      throw runtimeFault("CANCEL_UNSUPPORTED", agent.provider, "This adapter does not support task cancellation");
    }

    this.abortControllers.get(taskId)?.abort();
    void Promise.resolve().then(() => adapter.cancel(session, taskId)).catch(() => {
      if (agent.state !== "ERROR") this.setAgentState(agent, "ERROR");
      void this.persist();
    });
    if (record.state === "RUNNING" || record.state === "WAITING") this.transitionTask(record, "CANCELLED");
    await this.persist();
    return copyTaskRecord(record);
  }

  private createScheduledTask(input: A2ATaskSubmission, ancestry: TaskAncestry, deferExecution = false): ScheduledTask {
    validateSubmission(input);
    const room = this.requireRoom(input.roomId);
    const hasTarget = input.targetAgent !== undefined || input.targetSessionName !== undefined;
    if (hasTarget === (input.selector !== undefined)) {
      throw runtimeFault("INVALID_REQUEST", "", "Specify a session name/agent ID or a selector");
    }

    const parent = ancestry.parent;
    const maxDepth = input.maxDepth ?? parent?.task.maxDepth ?? this.policy.maxDepth;
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > this.policy.maxDepth) {
      throw runtimeFault("INVALID_REQUEST", "", "maxDepth is outside the routing policy");
    }
    const depth = parent ? parent.task.depth + 1 : 0;
    if (depth > maxDepth) throw runtimeFault("MAX_DEPTH_EXCEEDED", "", "Delegation depth limit reached");
    const timeoutMs = input.timeoutMs ?? this.policy.defaultTimeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw runtimeFault("INVALID_REQUEST", "", "timeoutMs must be a positive integer");
    const sourceAgent = parent?.task.targetAgent ?? ancestry.sourceAgent ?? "orchestrator";
    if (parent && parent.task.roomId !== room.roomId) throw runtimeFault("INVALID_REQUEST", "", "Delegation must remain in its room");

    const visited = parent ? [...parent.task.visitedAgents] : [];
    const agent = ancestry.resolvedTargetAgent
      ? this.selectResolvedAgent(room, ancestry.resolvedTargetAgent, input.selector, visited)
      : this.selectAgent(room, input.targetSessionName, input.targetAgent, input.selector, visited);
    if (!parent && ancestry.sourceAgent === agent.agentId) {
      throw runtimeFault("CYCLE_DETECTED", agent.provider, "An agent cannot assign a top-level task to its own session");
    }
    const id = this.uniqueTaskId();
    const task: AgentTask = {
      taskId: id,
      rootTaskId: parent?.task.rootTaskId ?? id,
      roomId: room.roomId,
      sourceAgent,
      targetAgent: agent.agentId,
      type: "REQUEST",
      message: input.message,
      depth,
      maxDepth,
      timeoutMs,
      createdAt: this.readClock(),
      visitedAgents: [...visited, agent.agentId],
      ...(parent ? { parentTaskId: parent.task.taskId } : {}),
      ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
    };
    const record: AgentTaskRecord = { task, state: "QUEUED", updatedAt: task.createdAt };
    this.tasks.set(task.taskId, record);
    this.emit({ type: "task.updated", task: record });

    const persisted = this.persist();
    const adapter = this.requireAdapter(agent.adapterId);
    const execute = async (): Promise<AgentTaskRecord> => {
      await persisted;
      return this.executeTask(record, agent, adapter, ancestry.signal);
    };
    let completion: Promise<AgentTaskRecord> | undefined;
    if (!deferExecution) {
      if (adapter.capabilities.concurrentTasks) {
        completion = execute();
      } else {
        const previous = this.serialTails.get(agent.agentId) ?? Promise.resolve();
        completion = previous.catch(() => undefined).then(execute);
        const tail = completion.then(() => undefined, () => undefined);
        this.serialTails.set(agent.agentId, tail);
        void tail.then(() => {
          if (this.serialTails.get(agent.agentId) === tail) this.serialTails.delete(agent.agentId);
        });
      }
    }
    return { record, persisted, ...(completion ? { completion } : {}) };
  }

  private selectAgent(
    room: AgentRoom,
    targetSessionName: string | undefined,
    targetAgent: string | undefined,
    selector: AgentSelector | undefined,
    visited: string[],
  ): AgentNode {
    const requestedName = targetSessionName ?? targetAgent;
    if (requestedName) {
      const named = this.findAgentsBySessionName(room, requestedName);
      const eligibleNamed = named.find((agent) => this.isEligible(agent, selector, visited));
      if (eligibleNamed) return eligibleNamed;
      if (targetAgent) {
        if (visited.includes(targetAgent)) throw runtimeFault("CYCLE_DETECTED", "", "Delegation would revisit an agent");
        const byId = this.agents.get(targetAgent);
        if (byId && room.agentIds.includes(targetAgent)) {
          if (!this.isEligible(byId, selector, visited)) throw runtimeFault("NO_AGENT_AVAILABLE", byId.provider, "Target agent is not available for this task");
          return byId;
        }
      }
      if (named[0]) {
        if (visited.includes(named[0].agentId)) throw runtimeFault("CYCLE_DETECTED", named[0].provider, "Delegation would revisit an agent");
        throw runtimeFault("NO_AGENT_AVAILABLE", named[0].provider, "The named session is not available for this task");
      }
      throw runtimeFault("NO_AGENT_AVAILABLE", "", "No session matches the requested name or agent ID");
    }

    const eligible = room.agentIds
      .map((agentId) => this.agents.get(agentId))
      .filter((agent): agent is AgentNode => agent !== undefined && this.isEligible(agent, selector, visited));
    eligible.sort((left, right) => {
      const leftLoad = this.agentLoad(left.agentId);
      const rightLoad = this.agentLoad(right.agentId);
      const leftStateRank = left.state === "IDLE" ? 0 : 1;
      const rightStateRank = right.state === "IDLE" ? 0 : 1;
      const leftWorkspaceRank = selector?.workspace && left.workspace === selector.workspace ? 0 : 1;
      const rightWorkspaceRank = selector?.workspace && right.workspace === selector.workspace ? 0 : 1;
      return leftLoad - rightLoad || leftStateRank - rightStateRank || leftWorkspaceRank - rightWorkspaceRank ||
        left.lastActivityAt - right.lastActivityAt || left.agentId.localeCompare(right.agentId);
    });
    const selected = eligible[0];
    if (!selected) throw runtimeFault("NO_AGENT_AVAILABLE", "", "No available agent matches the requested role and capabilities");
    return selected;
  }

  private selectResolvedAgent(room: AgentRoom, agentId: string, selector: AgentSelector | undefined, visited: string[]): AgentNode {
    if (visited.includes(agentId)) throw runtimeFault("CYCLE_DETECTED", "", "Delegation would revisit an agent");
    const agent = this.agents.get(agentId);
    if (!agent || !room.agentIds.includes(agentId) || !this.isEligible(agent, selector, visited)) {
      throw runtimeFault("NO_AGENT_AVAILABLE", agent?.provider ?? "", "Resolved target agent is not available for this task");
    }
    return agent;
  }

  private findAgentsBySessionName(room: AgentRoom, sessionName: string): AgentNode[] {
    const key = normalizeSessionName(sessionName);
    if (!key) return [];
    return room.agentIds
      .map((agentId) => this.agents.get(agentId))
      .filter((agent): agent is AgentNode => agent !== undefined && normalizeSessionName(agent.sessionName ?? "") === key)
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
  }

  private validateNativeTargetRequest(input: AgentSessionToolRequest, provider: string): void {
    requireNonEmpty(input.message, "message");
    if (input.targetAgent !== undefined) requireNonEmpty(input.targetAgent, "targetAgent");
    if (input.targetSessionName !== undefined) {
      requireNonEmpty(input.targetSessionName, "targetSessionName");
      if (input.targetSessionName.trim().length > 120) {
        throw runtimeFault("INVALID_REQUEST", provider, "targetSessionName must be 120 characters or fewer");
      }
    }
    const hasTarget = input.targetAgent !== undefined || input.targetSessionName !== undefined;
    if (hasTarget === (input.selector !== undefined)) {
      throw runtimeFault("INVALID_REQUEST", provider, "Specify a session name/agent ID or a selector");
    }
  }

  private async resolveNativeCallerTarget(
    source: AgentNode,
    sourceSession: NativeSession,
    room: AgentRoom,
    input: AgentSessionToolRequest,
    visited: string[],
  ): Promise<ResolvedNativeCallerTarget> {
    if (input.selector) return { selector: { ...input.selector } };
    if (!input.targetSessionName && input.targetAgent) {
      const byId = this.agents.get(input.targetAgent);
      if (byId && room.agentIds.includes(byId.agentId)) {
        return { targetAgent: byId.agentId, resolvedTargetAgent: byId.agentId };
      }
    }
    const lookupName = input.targetSessionName ?? input.targetAgent;
    let named: AgentNode[] = [];
    if (lookupName) {
      await this.ensureSessionsDiscovered(room.roomId);
      named = this.findAgentsBySessionName(room, lookupName).sort((left, right) => {
        const leftPreference = Number(left.provider !== source.provider) + Number(left.workspace !== sourceSession.workspace);
        const rightPreference = Number(right.provider !== source.provider) + Number(right.workspace !== sourceSession.workspace);
        return leftPreference - rightPreference || this.agentLoad(left.agentId) - this.agentLoad(right.agentId) ||
          left.lastActivityAt - right.lastActivityAt || left.agentId.localeCompare(right.agentId);
      });
      const availableByName = named.find((candidate) => this.isEligible(candidate, undefined, visited));
      if (availableByName) return { targetAgent: availableByName.agentId, resolvedTargetAgent: availableByName.agentId };
    }

    if (input.targetAgent) {
      const byId = this.agents.get(input.targetAgent);
      if (byId && room.agentIds.includes(byId.agentId)) return { targetAgent: byId.agentId, resolvedTargetAgent: byId.agentId };
    }
    if (named[0]) return { targetAgent: named[0].agentId, resolvedTargetAgent: named[0].agentId };

    const adapter = this.requireAdapter(source.adapterId);
    if (!sourceSession.workspace?.trim()) {
      throw runtimeFault("WORKSPACE_NOT_FOUND", source.provider, "The calling session has no workspace for a new A2A session");
    }
    if (!adapter.createSession) {
      throw runtimeFault("SESSION_CREATE_UNSUPPORTED", source.provider, "This provider adapter cannot create a user-accessible A2A session");
    }

    let inheritedPermissions: AgentPermissionProfile | undefined;
    if (adapter.permissionHandling !== "preserve-target") {
      if (!adapter.getPermissionProfile) {
        throw runtimeFault("PERMISSION_DENIED", source.provider, "The calling agent does not expose an inheritable permission profile");
      }
      inheritedPermissions = await adapter.getPermissionProfile(sourceSession);
      if (!inheritedPermissions || inheritedPermissions.provider !== source.provider) {
        throw runtimeFault("PERMISSION_DENIED", source.provider, "The calling agent's effective permissions could not be determined");
      }
    }

    const dedupeTarget = input.targetSessionName
      ? `name:${normalizeSessionName(input.targetSessionName)}`
      : `request:${input.targetAgent ?? "unnamed"}`;
    const creationKey = `${room.roomId}\u0000${source.agentId}\u0000${source.adapterId}\u0000${sourceSession.workspace}\u0000${dedupeTarget}`;
    let creation = this.sessionCreations.get(creationKey);
    if (!creation) {
      creation = this.createNativeCallerTarget(source, sourceSession, room, adapter, {
        ...(input.targetSessionName ? { sessionName: input.targetSessionName.trim() } : {}),
        ...(inheritedPermissions ? { inheritedPermissions } : {}),
      });
      this.sessionCreations.set(creationKey, creation);
    }
    try {
      const created = await creation;
      return { targetAgent: created.agentId, resolvedTargetAgent: created.agentId };
    } finally {
      if (this.sessionCreations.get(creationKey) === creation) this.sessionCreations.delete(creationKey);
    }
  }

  private async createNativeCallerTarget(
    source: AgentNode,
    sourceSession: NativeSession,
    room: AgentRoom,
    adapter: AgentAdapter,
    input: { sessionName?: string; inheritedPermissions?: AgentPermissionProfile },
  ): Promise<AgentNode> {
    const session = await adapter.createSession!(sourceSession, input);
    validateNativeSession(session);
    if (session.provider !== source.provider || session.workspace !== sourceSession.workspace) {
      throw runtimeFault("INVALID_REQUEST", source.provider, "The new A2A session did not retain the caller's provider workspace");
    }
    const agentId = this.dependencies.createId("agent");
    if (typeof agentId !== "string" || !agentId.trim() || this.agents.has(agentId)) {
      throw runtimeFault("INVALID_REQUEST", source.provider, "Could not allocate an agent ID for the new session");
    }
    return this.registerAgent(room.roomId, {
      agentId,
      adapterId: adapter.adapterId,
      session: {
        ...session,
        ...(input.sessionName ? { sessionName: input.sessionName } : {}),
      },
    });
  }

  private isEligible(agent: AgentNode, selector: AgentSelector | undefined, visited: string[]): boolean {
    if (visited.includes(agent.agentId)) return false;
    if (selector?.role && agent.role !== selector.role) return false;
    if (selector?.provider && agent.provider !== selector.provider) return false;
    if (selector?.workspace && agent.workspace !== selector.workspace) return false;
    if (selector?.capabilities?.some((capability) => !agent.capabilities.includes(capability))) return false;
    const adapter = this.adapters.get(agent.adapterId);
    const session = this.sessions.get(agent.agentId);
    if (!adapter || !session || agent.state === "OFFLINE" || agent.state === "ERROR") return false;
    const descriptor = adapter;
    if (descriptor.integrationStatus === "UNAVAILABLE" || descriptor.integrationStatus === "MANUAL_CONFIGURATION_REQUIRED" ||
        descriptor.evidence.source === "unsupported") return false;
    if (descriptor.integrationStatus === "EXPERIMENTAL" && !this.policy.allowExperimentalAdapters) return false;
    if (this.policy.requireResumeCapability && !descriptor.capabilities.resumeSession) return false;
    if (this.policy.requireStructuredOutput && !descriptor.capabilities.structuredOutput) return false;
    if (this.policy.requireCancellation && !descriptor.capabilities.cancellation) return false;
    if (session.persistenceLevel === 2 && !descriptor.capabilities.resumeSession) return false;
    if (session.persistenceLevel === 3 && !descriptor.capabilities.attachExistingProcess) return false;
    const busy = agent.state === "WORKING" || agent.state === "WAITING";
    if (!busy) return agent.state === "IDLE";
    return descriptor.capabilities.concurrentTasks || this.policy.allowQueueing;
  }

  private async executeTask(
    record: AgentTaskRecord,
    agent: AgentNode,
    adapter: AgentAdapter,
    parentSignal?: AbortSignal,
  ): Promise<AgentTaskRecord> {
    if (isTerminalTask(record.state)) return copyTaskRecord(record);
    const remainingTimeoutMs = record.task.timeoutMs - Math.max(0, this.readClock() - record.task.createdAt);
    if (remainingTimeoutMs <= 0) {
      record.error = runtimeFault("TIMEOUT", agent.provider, "Agent task expired while queued", true).detail;
      this.transitionTask(record, "TIMED_OUT");
      await this.persist();
      return copyTaskRecord(record);
    }
    const session = this.sessions.get(agent.agentId);
    if (!session) {
      this.finishFailure(record, runtimeFault("SESSION_NOT_FOUND", agent.provider, "Registered native session was not found").detail);
      await this.persist();
      return copyTaskRecord(record);
    }
    if (parentSignal?.aborted) {
      this.transitionTask(record, "CANCELLED");
      await this.persist();
      return copyTaskRecord(record);
    }

    const controller = new AbortController();
    this.abortControllers.set(record.task.taskId, controller);
    let timedOut = false;
    const availabilityTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, remainingTimeoutMs);
    let available: boolean;
    try {
      available = await raceWithAbort(adapter.isAvailable(session), controller.signal, () => timedOut);
    } catch {
      clearTimeout(availabilityTimer);
      this.abortControllers.delete(record.task.taskId);
      if (isTerminalTask(record.state)) return copyTaskRecord(record);
      if (timedOut) {
        this.setAgentState(agent, "OFFLINE", "ADAPTER_UNAVAILABLE");
        record.error = runtimeFault("TIMEOUT", agent.provider, "Agent availability check exceeded the task timeout", true).detail;
        this.transitionTask(record, "TIMED_OUT");
      } else {
        this.setAgentState(agent, "OFFLINE", "ADAPTER_UNAVAILABLE");
        this.finishFailure(record, runtimeFault("PROVIDER_UNAVAILABLE", agent.provider, "Agent adapter is unavailable", true).detail);
      }
      await this.persist();
      return copyTaskRecord(record);
    }
    clearTimeout(availabilityTimer);
    if (isTerminalTask(record.state)) {
      this.abortControllers.delete(record.task.taskId);
      return copyTaskRecord(record);
    }
    if (!available) {
      this.abortControllers.delete(record.task.taskId);
      this.setAgentState(agent, "OFFLINE", "SESSION_UNAVAILABLE");
      this.finishFailure(record, runtimeFault("SESSION_NOT_FOUND", agent.provider, "Native session is unavailable", true).detail);
      await this.persist();
      return copyTaskRecord(record);
    }
    let inheritedPermissions: AgentPermissionProfile | undefined;
    try {
      inheritedPermissions = await this.resolveInheritedPermissionProfile(record.task, session, adapter);
    } catch (error) {
      this.abortControllers.delete(record.task.taskId);
      this.finishFailure(record, normalizeAdapterError(error, agent.provider));
      await this.persist();
      return copyTaskRecord(record);
    }
    if (session.persistenceLevel === 2 && !adapter.capabilities.resumeSession) {
      this.abortControllers.delete(record.task.taskId);
      this.finishFailure(record, runtimeFault("RESUME_UNSUPPORTED", agent.provider, "Adapter cannot resume this native session").detail);
      await this.persist();
      return copyTaskRecord(record);
    }
    if (session.persistenceLevel === 3 && (!adapter.capabilities.attachExistingProcess || !adapter.attach)) {
      this.abortControllers.delete(record.task.taskId);
      this.finishFailure(record, runtimeFault("ATTACH_UNSUPPORTED", agent.provider, "Adapter cannot attach to this native process").detail);
      await this.persist();
      return copyTaskRecord(record);
    }
    let adapterTimeoutMs = record.task.timeoutMs - Math.max(0, this.readClock() - record.task.createdAt);
    if (adapterTimeoutMs <= 0) {
      this.abortControllers.delete(record.task.taskId);
      record.error = runtimeFault("TIMEOUT", agent.provider, "Agent task expired before execution", true).detail;
      this.transitionTask(record, "TIMED_OUT");
      await this.persist();
      return copyTaskRecord(record);
    }

    if (parentSignal?.aborted) {
      this.abortControllers.delete(record.task.taskId);
      this.transitionTask(record, "CANCELLED");
      await this.persist();
      return copyTaskRecord(record);
    }

    let releaseWorkspaceLock: (() => void) | undefined;
    const workspaceLock = { release: undefined as (() => void) | undefined };
    if (agent.workspace) {
      let lockTimedOut = false;
      const lockTimeoutMs = record.task.timeoutMs - Math.max(0, this.readClock() - record.task.createdAt);
      if (lockTimeoutMs <= 0) {
        this.abortControllers.delete(record.task.taskId);
        record.error = runtimeFault("TIMEOUT", agent.provider, "Agent task expired while waiting for its workspace", true).detail;
        this.transitionTask(record, "TIMED_OUT");
        await this.persist();
        return copyTaskRecord(record);
      }
      const lockTimer = setTimeout(() => {
        lockTimedOut = true;
        timedOut = true;
        controller.abort();
      }, lockTimeoutMs);
      const lockPromise = this.dependencies.workspaceLocks.acquire(agent.workspace, controller.signal);
      try {
        releaseWorkspaceLock = await raceWithAbort(lockPromise, controller.signal, () => lockTimedOut);
        workspaceLock.release = releaseWorkspaceLock;
        this.workspaceLockReleases.set(record.task.taskId, workspaceLock);
      } catch {
        clearTimeout(lockTimer);
        void lockPromise.then((release) => release(), () => undefined);
        this.abortControllers.delete(record.task.taskId);
        releaseWorkspaceLock?.();
        workspaceLock.release = undefined;
        this.workspaceLockReleases.delete(record.task.taskId);
        if (!isTerminalTask(record.state)) {
          if (lockTimedOut) {
            record.error = runtimeFault("TIMEOUT", agent.provider, "Agent task timed out waiting for its workspace", true).detail;
            this.transitionTask(record, "TIMED_OUT");
          } else {
            this.transitionTask(record, "CANCELLED");
          }
        }
        await this.persist();
        return copyTaskRecord(record);
      }
      clearTimeout(lockTimer);
      if (isTerminalTask(record.state) || controller.signal.aborted || parentSignal?.aborted) {
        releaseWorkspaceLock();
        workspaceLock.release = undefined;
        this.workspaceLockReleases.delete(record.task.taskId);
        this.abortControllers.delete(record.task.taskId);
        if (!isTerminalTask(record.state)) {
          if (timedOut) {
            record.error = runtimeFault("TIMEOUT", agent.provider, "Agent task timed out waiting for its workspace", true).detail;
            this.transitionTask(record, "TIMED_OUT");
          } else {
            this.transitionTask(record, "CANCELLED");
          }
        }
        await this.persist();
        return copyTaskRecord(record);
      }
    }
    adapterTimeoutMs = record.task.timeoutMs - Math.max(0, this.readClock() - record.task.createdAt);
    if (adapterTimeoutMs <= 0) {
      releaseWorkspaceLock?.();
      workspaceLock.release = undefined;
      this.workspaceLockReleases.delete(record.task.taskId);
      this.abortControllers.delete(record.task.taskId);
      record.error = runtimeFault("TIMEOUT", agent.provider, "Agent task expired before execution", true).detail;
      this.transitionTask(record, "TIMED_OUT");
      await this.persist();
      return copyTaskRecord(record);
    }
    this.addActive(agent.agentId, record.task.taskId);
    this.setAgentState(agent, "WORKING");
    this.transitionTask(record, "RUNNING");
    await this.persist();

    const context: AgentExecutionContext = {
      signal: controller.signal,
      history: [],
      agents: this.listAgents(record.task.roomId),
      ...(inheritedPermissions ? { inheritedPermissions: { ...inheritedPermissions } } : {}),
      delegate: async (request) => {
        if (!adapter.capabilities.delegation) {
          throw runtimeFault("PERMISSION_DENIED", agent.provider, "This adapter does not expose task delegation");
        }
        if (controller.signal.aborted) throw runtimeFault("PROCESS_EXITED", agent.provider, "Parent task is no longer active");
        this.addWaiting(agent.agentId, record.task.taskId);
        this.transitionTask(record, "WAITING");
        this.setAgentState(agent, "WAITING");
        await this.persist();
        releaseWorkspaceLock?.();
        releaseWorkspaceLock = undefined;
        workspaceLock.release = undefined;
        let cancelChild: (() => void) | undefined;
        try {
          const target = await this.resolveNativeCallerTarget(agent, session, this.requireRoom(record.task.roomId), request, record.task.visitedAgents);
          const { resolvedTargetAgent, ...submissionTarget } = target;
          const child = this.createScheduledTask({
            roomId: record.task.roomId,
            ...submissionTarget,
            message: request.message,
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
            maxDepth: record.task.maxDepth,
          }, { parent: record, signal: controller.signal, ...(resolvedTargetAgent ? { resolvedTargetAgent } : {}) });
          cancelChild = (): void => { void this.cancelTask(child.record.task.taskId).catch(() => undefined); };
          controller.signal.addEventListener("abort", cancelChild, { once: true });
          if (controller.signal.aborted) cancelChild();
          await child.persisted;
          return await child.completion!;
        } finally {
          if (cancelChild) controller.signal.removeEventListener("abort", cancelChild);
          if (agent.workspace && !controller.signal.aborted && !isTerminalTask(record.state)) {
            const remaining = record.task.timeoutMs - Math.max(0, this.readClock() - record.task.createdAt);
            if (remaining <= 0) {
              timedOut = true;
              controller.abort();
            } else {
              releaseWorkspaceLock = await this.dependencies.workspaceLocks.acquire(agent.workspace, controller.signal);
              workspaceLock.release = releaseWorkspaceLock;
              this.workspaceLockReleases.set(record.task.taskId, workspaceLock);
            }
          }
          this.removeWaiting(agent.agentId, record.task.taskId);
          if (!isTerminalTask(record.state) && record.state === "WAITING") this.transitionTask(record, "RUNNING");
          this.setDerivedAgentState(agent);
          await this.persist();
        }
      },
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      if (adapter.capabilities.cancellation) {
        void Promise.resolve().then(() => adapter.cancel(session, record.task.taskId)).catch(() => {
          if (agent.state !== "ERROR") this.setAgentState(agent, "ERROR");
          void this.persist();
        });
      } else {
        // The runtime can stop waiting, but it cannot claim the native task stopped.
        this.setAgentState(agent, "ERROR");
        void this.persist();
      }
    }, adapterTimeoutMs);
    let operation: Promise<AgentResult> | undefined;
    try {
      const input: AgentInput = { task: copyTaskRecord(record).task, message: record.task.message };
      operation = session.persistenceLevel === 3
        ? adapter.attach?.(session, input, context) ?? Promise.reject(runtimeFault("ATTACH_UNSUPPORTED", agent.provider, "Process attachment is unavailable"))
        : session.persistenceLevel === 2
          ? adapter.resume(session, input, context)
          : adapter.execute(session, record.task, context);
      const rawResult = await raceWithAbort(operation, controller.signal, () => timedOut);
      const result = parseAgentResult(rawResult, record.task.taskId, agent.agentId);
      if (result.status === "COMPLETED") {
        record.result = result;
        this.transitionTask(record, "COMPLETED");
        if (session.persistenceLevel === 1 && session.runtimeManagedHistory) {
          const history = this.histories.get(agent.agentId) ?? [];
          const createdAt = this.readClock();
          history.push(
            { taskId: record.task.taskId, role: "user", message: record.task.message, createdAt },
            { taskId: record.task.taskId, role: "assistant", message: result.message, createdAt },
          );
          this.histories.set(agent.agentId, history);
        }
      } else if (result.status === "CANCELLED") {
        record.result = result;
        this.transitionTask(record, "CANCELLED");
      } else if (result.status === "TIMED_OUT") {
        record.result = result;
        this.transitionTask(record, "TIMED_OUT");
      } else {
        record.result = result;
        this.transitionTask(record, "FAILED");
      }
    } catch (error) {
      let effectiveError = error;
      if (controller.signal.aborted && inheritedPermissions && adapter.capabilities.cancellation && operation) {
        // Let adapters finish cancellation cleanup (including temporary permission restoration)
        // before releasing the per-agent and workspace locks.
        try {
          await operation;
        } catch (operationError) {
          effectiveError = operationError;
        }
      }
      const adapterError = normalizeAdapterError(effectiveError, agent.provider);
      if (adapterError.code === "PERMISSION_RESTORE_FAILED") {
        if (agent.state !== "ERROR") this.setAgentState(agent, "ERROR");
        this.finishFailure(record, adapterError);
      } else if (timedOut) {
        record.error = runtimeFault("TIMEOUT", agent.provider, "Agent task exceeded its timeout", true).detail;
        if (!isTerminalTask(record.state)) this.transitionTask(record, "TIMED_OUT");
      } else if (controller.signal.aborted) {
        if (!isTerminalTask(record.state)) this.transitionTask(record, "CANCELLED");
      } else {
        this.finishFailure(record, adapterError);
      }
    } finally {
      clearTimeout(timeoutTimer);
      workspaceLock.release?.();
      workspaceLock.release = undefined;
      this.workspaceLockReleases.delete(record.task.taskId);
      this.abortControllers.delete(record.task.taskId);
      this.removeActive(agent.agentId, record.task.taskId);
      this.removeWaiting(agent.agentId, record.task.taskId);
      agent.lastActivityAt = this.readClock();
      this.setDerivedAgentState(agent);
      record.updatedAt = this.readClock();
      this.emit({ type: "task.updated", task: record });
      this.emit({ type: "agent.updated", agent: copyAgentSummary(agent) });
      await this.persist();
    }
    return copyTaskRecord(record);
  }

  private async resolveInheritedPermissionProfile(
    task: AgentTask,
    targetSession: NativeSession,
    targetAdapter: AgentAdapter,
  ): Promise<AgentPermissionProfile | undefined> {
    if (task.sourceAgent === "orchestrator") return undefined;
    if (targetAdapter.permissionHandling === "preserve-target") return undefined;
    const source = this.agents.get(task.sourceAgent);
    const sourceSession = this.sessions.get(task.sourceAgent);
    const sourceAdapter = source ? this.adapters.get(source.adapterId) : undefined;
    if (!source || !sourceSession || !sourceAdapter || !this.requireRoom(task.roomId).agentIds.includes(source.agentId)) {
      throw runtimeFault("PERMISSION_DENIED", targetSession.provider, "Could not identify the A2A caller's permissions");
    }
    if (!sourceAdapter.getPermissionProfile) {
      throw runtimeFault("PERMISSION_DENIED", source.provider, "The calling agent does not expose an inheritable permission profile");
    }
    const profile = await sourceAdapter.getPermissionProfile(sourceSession);
    if (!profile || profile.provider !== source.provider) {
      throw runtimeFault("PERMISSION_DENIED", source.provider, "The calling agent's effective permissions could not be determined");
    }
    if (!targetAdapter.canInheritPermissionProfile?.(targetSession, profile)) {
      throw runtimeFault("PERMISSION_DENIED", targetSession.provider, "The target agent cannot safely inherit the caller's permission profile");
    }
    return { ...profile };
  }

  private finishFailure(record: AgentTaskRecord, error: AdapterError): void {
    record.error = error;
    if (record.state === "QUEUED" || record.state === "RUNNING" || record.state === "WAITING") this.transitionTask(record, "FAILED");
  }

  private transitionTask(record: AgentTaskRecord, next: TaskState): void {
    if (!canTransitionTask(record.state, next)) throw new Error(`Invalid task state transition: ${record.state} -> ${next}`);
    record.state = next;
    record.updatedAt = this.readClock();
    this.emit({ type: "task.updated", task: record });
    if (isTerminalTask(next)) this.publishTaskResultSummary(record);
  }

  private publishTaskResultSummary(record: AgentTaskRecord): void {
    if (record.task.metadata?.delivery !== "a2a-async-request" || record.task.sourceAgent === "orchestrator") return;
    const caller = this.agents.get(record.task.sourceAgent);
    const callerSession = caller ? this.sessions.get(caller.agentId) : undefined;
    const callerAdapter = caller ? this.adapters.get(caller.adapterId) : undefined;
    const address = callerSession ? callerAdapter?.getPromptAddress?.(callerSession) : undefined;
    const provider = assistantProvider(caller?.provider ?? "");
    if (!caller || !address || !provider) return;
    const records = record.task.parentTaskId
      ? [record]
      : [...this.tasks.values()]
        .filter((candidate) => candidate.task.rootTaskId === record.task.rootTaskId && isTerminalTask(candidate.state))
        .sort((left, right) => left.task.createdAt - right.task.createdAt || left.task.taskId.localeCompare(right.task.taskId));
    const communications = records.flatMap((candidate): PendingA2ACommunication[] => {
      const source = this.agents.get(candidate.task.sourceAgent);
      const responder = this.agents.get(candidate.task.targetAgent);
      return [
        ...(source ? [{
          kind: "request" as const,
          taskId: candidate.task.taskId,
          sourceAgentId: source.agentId,
          ...(source.sessionName ? { sourceSessionName: source.sessionName } : {}),
          message: candidate.task.message,
        }] : []),
        {
          kind: "result" as const,
          taskId: candidate.task.taskId,
          sourceAgentId: candidate.task.targetAgent,
          ...(responder?.sessionName ? { sourceSessionName: responder.sessionName } : {}),
          message: candidate.result?.message ?? candidate.error?.message ?? `Task ${candidate.state.toLowerCase()}.`,
        },
      ];
    });
    const summaryId = a2aCommunicationGroupKey(communications);
    const publicationKey = `${caller.agentId}\u0000${summaryId}`;
    if (!communications.length || this.taskResultSummaries.has(publicationKey)) return;
    this.taskResultSummaries.add(publicationKey);
    try {
      this.dependencies.publishAssistantEvent?.({
        type: "a2aCommunicationSummary",
        target: address.target,
        threadId: address.threadId,
        provider,
        summaryId,
        communications,
      });
    } catch {
      // A transcript summary is a notification and must not change task completion.
    }
  }

  private setAgentState(agent: AgentNode, next: AgentNode["state"], offlineReason?: AgentNode["offlineReason"]): void {
    if (!canTransitionAgent(agent.state, next)) throw new Error(`Invalid agent state transition: ${agent.state} -> ${next}`);
    agent.state = next;
    if (next === "OFFLINE") agent.offlineReason = offlineReason ?? "SESSION_UNAVAILABLE";
    else delete agent.offlineReason;
    agent.lastActivityAt = this.readClock();
    this.emit({ type: "agent.updated", agent: copyAgentSummary(agent) });
  }

  private setDerivedAgentState(agent: AgentNode): void {
    const active = this.activeTasks.get(agent.agentId);
    const waiting = this.waitingTasks.get(agent.agentId);
    if (!active || active.size === 0) {
      if (agent.state !== "OFFLINE" && agent.state !== "ERROR") this.setAgentState(agent, "IDLE");
      delete agent.currentTaskId;
      return;
    }
    const currentTaskId = active.values().next().value;
    if (currentTaskId) agent.currentTaskId = currentTaskId;
    const next = waiting && waiting.size >= active.size ? "WAITING" : "WORKING";
    if (agent.state !== next) this.setAgentState(agent, next);
  }

  private addActive(agentId: string, taskId: string): void {
    const active = this.activeTasks.get(agentId) ?? new Set<string>();
    active.add(taskId);
    this.activeTasks.set(agentId, active);
    this.refreshCurrentTaskId(agentId);
  }

  private removeActive(agentId: string, taskId: string): void {
    const active = this.activeTasks.get(agentId);
    active?.delete(taskId);
    if (active?.size === 0) this.activeTasks.delete(agentId);
    this.refreshCurrentTaskId(agentId);
  }

  private addWaiting(agentId: string, taskId: string): void {
    const waiting = this.waitingTasks.get(agentId) ?? new Set<string>();
    waiting.add(taskId);
    this.waitingTasks.set(agentId, waiting);
  }

  private removeWaiting(agentId: string, taskId: string): void {
    const waiting = this.waitingTasks.get(agentId);
    waiting?.delete(taskId);
    if (waiting?.size === 0) this.waitingTasks.delete(agentId);
  }

  private refreshCurrentTaskId(agentId: string): void {
    const agent = this.agents.get(agentId);
    const first = this.activeTasks.get(agentId)?.values().next().value;
    if (agent && first) agent.currentTaskId = first;
    else if (agent) delete agent.currentTaskId;
  }

  private agentLoad(agentId: string): number {
    let count = 0;
    for (const record of this.tasks.values()) {
      if (record.task.targetAgent === agentId && record.state === "QUEUED") count += 1;
    }
    return count + (this.activeTasks.get(agentId)?.size ?? 0);
  }

  private uniqueTaskId(): string {
    const taskId = this.dependencies.createId("task");
    if (typeof taskId !== "string" || !taskId || this.tasks.has(taskId)) {
      throw runtimeFault("INVALID_REQUEST", "", "Task ID generator returned an invalid or duplicate ID");
    }
    return taskId;
  }

  private requireRoom(roomId: string): AgentRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw runtimeFault("INVALID_REQUEST", "", "Room does not exist");
    return room;
  }

  private requireAdapter(adapterId: string): AgentAdapter {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) throw runtimeFault("PROVIDER_UNAVAILABLE", "", "Agent adapter is unavailable", true);
    return adapter;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("A2ARuntime.initialize() must be called first");
  }

  private readClock(): number {
    const value = this.dependencies.now();
    if (!Number.isFinite(value)) throw new Error("A2A clock returned an invalid timestamp");
    return value;
  }

  private persist(): Promise<void> {
    const snapshot = {
      rooms: [...this.rooms.values()].map(copyRoom),
      agents: [...this.agents.values()].map(copyAgent),
      sessions: [...this.sessions.entries()].map(([agentId, session]) => ({ agentId, session: { ...session } })),
      histories: [...this.histories.entries()].map(([agentId, entries]) => ({ agentId, entries: entries.map((entry) => ({ ...entry })) })),
      tasks: [...this.tasks.values()].map(copyTaskRecord),
    };
    const write = this.persistenceTail.catch(() => undefined).then(() => this.dependencies.stateStore.save(snapshot));
    this.persistenceTail = write;
    return write;
  }

  private emit(event: A2ARuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(copyEvent(event));
      } catch {
        // Observability listeners must not disrupt task execution.
      }
    }
  }
}

function normalizeSessionName(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

function interpretationKey(provider: string, target: string, threadId: string): string {
  return `${provider}\u0000${target}\u0000${threadId}`;
}

function assistantProvider(value: string): AssistantProvider | undefined {
  return value === "codex" || value === "opencode" || value === "kiro" ? value : undefined;
}

function toTaskWaitResult(record: AgentTaskRecord): A2ATaskWaitResult {
  return {
    completed: isTerminalTask(record.state),
    taskId: record.task.taskId,
    state: record.state,
    ...(record.result ? { result: copyTaskRecord(record).result } : {}),
    ...(record.error ? { error: { ...record.error } } : {}),
  };
}
