import type {
  AdapterErrorCode,
  AdapterError,
  AdapterCapabilities,
  AgentInput,
  AgentHistoryEntry,
  AgentPermissionProfile,
  AgentRoom,
  AgentResult,
  AgentSummary,
  AgentTask,
  AgentTaskRecord,
  A2ATaskSubmission,
  IntegrationEvidence,
  NativeSession,
  A2ARuntimeSnapshot,
  AgentSelector,
  TaskState,
} from "../../domain/a2a.js";

export type IntegrationStatus = "VERIFIED" | "PARTIALLY_VERIFIED" | "EXPERIMENTAL" | "UNAVAILABLE" | "MANUAL_CONFIGURATION_REQUIRED";

export type AgentAdapterDescriptor = {
  readonly adapterId: string;
  readonly provider: string;
  readonly integrationStatus: IntegrationStatus;
  readonly capabilities: Readonly<AdapterCapabilities>;
  readonly evidence: IntegrationEvidence;
};

export type AgentExecutionContext = {
  signal: AbortSignal;
  history: AgentHistoryEntry[];
  agents: AgentSummary[];
  /** Permissions of the agent that requested this task, when the adapter can identify them. */
  inheritedPermissions?: AgentPermissionProfile;
  delegate(input: AgentSessionToolRequest): Promise<AgentTaskRecord>;
};

export type AgentSessionToolRequest = {
  targetAgent?: string;
  targetSessionName?: string;
  selector?: AgentSelector;
  message: string;
  timeoutMs?: number;
  /** Links a result interpretation callback to the asynchronous request that created it. */
  callbackForTaskId?: string;
};

export type A2ATaskWaitResult = {
  completed: boolean;
  taskId: string;
  state: TaskState;
  result?: AgentResult;
  error?: AdapterError;
};

export type AgentPromptAddress = { target: string; threadId: string };

/** Product-specific session operations stay behind this application-owned port. */
export interface AgentAdapter extends AgentAdapterDescriptor {
  /** Preserve the target session's own permission configuration instead of inheriting caller permissions. */
  readonly permissionHandling?: "inherit-caller" | "preserve-target";

  discoverSessions(): Promise<NativeSession[]>;

  /** Create a persistent provider session beside the caller when a named/ID target is missing. */
  createSession?(source: NativeSession, input: {
    sessionName?: string;
    inheritedPermissions?: AgentPermissionProfile;
  }): Promise<NativeSession>;

  getDiscoveryFailures?(): AdapterErrorCode[];

  isAvailable(session: NativeSession): Promise<boolean>;

  /** Match a provider-visible session ID to the adapter-owned native session handle. */
  matchesNativeSession?(session: NativeSession, nativeSessionId: string): boolean;

  /** Match a provider target when the native tool call does not include a session ID. */
  matchesNativeTarget?(session: NativeSession, target: string): boolean;

  /** Provider address used by Hive to resume a native session with hidden queued A2A context. */
  getPromptAddress?(session: NativeSession): AgentPromptAddress | undefined;

  /** Whether this particular native session received a callable A2A tool. */
  canDelegate?(session: NativeSession): boolean;

  /** Read the effective provider permission profile for a caller session. */
  getPermissionProfile?(session: NativeSession): Promise<AgentPermissionProfile | undefined>;

  /** Resolve an active task from a provider-native session/thread ID when the MCP client supplies one. */
  getActiveTaskIdForSession?(session: NativeSession, nativeSessionId: string): string | undefined;

  /** Whether this adapter can apply the caller's permissions to this target session. */
  canInheritPermissionProfile?(session: NativeSession, profile: AgentPermissionProfile): boolean;

  /** Optional observation of a native turn already in progress outside this task runtime. */
  isBusy?(session: NativeSession): Promise<boolean>;

  execute(session: NativeSession, task: AgentTask, context: AgentExecutionContext): Promise<AgentResult>;

  resume(session: NativeSession, input: AgentInput, context: AgentExecutionContext): Promise<AgentResult>;

  attach?(session: NativeSession, input: AgentInput, context: AgentExecutionContext): Promise<AgentResult>;

  cancel(session: NativeSession, taskId: string): Promise<void>;
}

/** Persistence port for runtime state; native conversation context remains provider-owned. */
export interface A2ARuntimeStateStore {
  load(): Promise<A2ARuntimeSnapshot>;
  save(snapshot: A2ARuntimeSnapshot): Promise<void>;
}

/** Coordinates concurrent tasks that target the same filesystem workspace. */
export interface A2AWorkspaceLockPort {
  acquire(workspace: string, signal: AbortSignal): Promise<() => void>;
}

export type A2ARuntimeEvent =
  | { type: "room.updated"; room: AgentRoom }
  | { type: "agent.updated"; agent: AgentSummary }
  | { type: "task.updated"; task: AgentTaskRecord };

export type A2ARuntimeEventHandler = (event: A2ARuntimeEvent) => void;

export type A2ADiscoveryResult = {
  registered: AgentSummary[];
  skipped: Array<{ adapterId: string; code: import("../../domain/a2a.js").AdapterErrorCode }>;
};

export type A2AAgentProfileUpdate = {
  role?: string | null;
  capabilities?: string[];
};

/** Transport-facing application port. HTTP, WebSocket, and local callers share these semantics. */
export interface A2ARuntimePort {
  listRooms(): AgentRoom[];
  listAgents(roomId: string): AgentSummary[];
  listAgentsForAgent(agentId: string): AgentSummary[];
  findAgentForNativeSession(provider: string, nativeSessionId: string): AgentSummary | undefined;
  resolveNativeSessionAgent(provider: string, nativeSessionId: string): Promise<AgentSummary | undefined>;
  findActiveAgentForTarget(provider: string, target: string): Promise<AgentSummary | undefined>;
  resolveActiveAgentForTarget(provider: string, target: string): Promise<AgentSummary | undefined>;
  resolveActiveAgentForTask(provider: string, agentId: string): Promise<AgentSummary | undefined>;
  /** Persist an agent-originated request and return its accepted task record without waiting for completion. */
  sendFromNativeSession(provider: string, nativeSessionId: string, input: AgentSessionToolRequest): Promise<AgentTaskRecord>;
  /** Resolve the caller, persist the request, and return its accepted task record without waiting for completion. */
  sendFromActiveSession(provider: string, target: string, input: AgentSessionToolRequest): Promise<AgentTaskRecord>;
  /** Persist an agent-originated request or result callback and return once it is accepted. */
  sendFromAgent(agentId: string, input: AgentSessionToolRequest): Promise<AgentTaskRecord>;
  /** Wait briefly for an accepted task result; callers may repeat while completed is false. */
  waitForTask(taskId: string, waitMs?: number): Promise<A2ATaskWaitResult>;
  getTask(taskId: string): AgentTaskRecord | undefined;
  getTaskGraph(rootTaskId: string): AgentTaskRecord[];
  enqueueTask(input: A2ATaskSubmission): Promise<AgentTaskRecord>;
  submitTask(input: A2ATaskSubmission): Promise<AgentTaskRecord>;
  cancelTask(taskId: string): Promise<AgentTaskRecord>;
  subscribe(handler: A2ARuntimeEventHandler): () => void;
}

/** Administrative operations are kept distinct from the remote task transport surface. */
export interface A2ARuntimeAdminPort extends A2ARuntimePort {
  listAdapters(): AgentAdapterDescriptor[];
  createRoom(roomId: string, name: string): Promise<AgentRoom>;
  discoverSessions(roomId: string, adapterId?: string): Promise<A2ADiscoveryResult>;
  ensureSessionsDiscovered(roomId: string): Promise<void>;
  refreshAvailability(roomId: string): Promise<AgentSummary[]>;
  updateAgentProfile(agentId: string, update: A2AAgentProfileUpdate): Promise<AgentSummary>;
}
