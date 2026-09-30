/** Provider-neutral contracts for the local A2A collaboration runtime. */

export type AgentState = "IDLE" | "WORKING" | "WAITING" | "ERROR" | "OFFLINE";

export type TaskState = "QUEUED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export type TaskMessageType = "REQUEST" | "RESULT" | "ERROR" | "CANCEL";

/** An agent-authored request or result that can be presented separately from user chat. */
export type A2ACommunicationSummaryItem = {
  kind: "request" | "result";
  taskId: string;
  sourceAgentId: string;
  sourceSessionName?: string;
  message: string;
};

/** Stable identity shared by live events and provider transcript reconstruction. */
export function a2aCommunicationGroupKey(communications: readonly Pick<A2ACommunicationSummaryItem, "taskId">[]): string {
  return JSON.stringify([...new Set(communications.map(({ taskId }) => taskId))].sort()) ?? "[]";
}

export type PersistenceLevel = 0 | 1 | 2 | 3;

export type AdapterCapabilities = {
  discoverSessions: boolean;
  attachExistingProcess: boolean;
  resumeSession: boolean;
  persistentContext: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  cancellation: boolean;
  toolCalling: boolean;
  fileAccess: boolean;
  shellAccess: boolean;
  delegation: boolean;
  concurrentTasks: boolean;
};

export type IntegrationEvidence = {
  source:
    | "official-sdk"
    | "official-api"
    | "official-cli"
    | "documented-command"
    | "observed-cli"
    | "pty"
    | "local-state"
    | "hive-provider-port"
    | "unsupported";
  verifiedVersion?: string;
  verifiedAt: string;
  limitations: string[];
  confidence: "high" | "medium" | "low";
};

/** A sanitized handle. Provider-private process/session details stay inside its adapter. */
export type NativeSession = {
  sessionId: string;
  provider: string;
  /** Provider-visible name/title shown to the user for this session. */
  sessionName?: string;
  workspace?: string;
  persistenceLevel: PersistenceLevel;
  runtimeManagedHistory: boolean;
};

export type AgentNode = {
  agentId: string;
  provider: string;
  adapterId: string;
  nativeSessionId: string;
  role?: string;
  capabilities: string[];
  state: AgentState;
  currentTaskId?: string;
  sessionName?: string;
  workspace?: string;
  lastActivityAt: number;
  offlineReason?: "SESSION_UNAVAILABLE" | "ADAPTER_UNAVAILABLE" | "PROCESS_TERMINATED";
};

/** Information safe to expose over A2A; native session and adapter IDs stay local. */
export type AgentSummary = Omit<AgentNode, "adapterId" | "nativeSessionId">;

export type AgentRoom = {
  roomId: string;
  name: string;
  agentIds: string[];
  createdAt: number;
};

export type AgentTask = {
  taskId: string;
  rootTaskId: string;
  parentTaskId?: string;
  roomId: string;
  sourceAgent: string;
  targetAgent: string;
  type: TaskMessageType;
  message: string;
  depth: number;
  maxDepth: number;
  timeoutMs: number;
  createdAt: number;
  visitedAgents: string[];
  metadata?: Record<string, unknown>;
};

export type AgentInput = {
  task: AgentTask;
  message: string;
};

export type AgentHistoryEntry = {
  taskId: string;
  role: "user" | "assistant";
  message: string;
  createdAt: number;
};

/** Provider-specific permissions captured from an A2A caller for one delegated task. */
export type AgentPermissionProfile = {
  provider: string;
  profile: string;
};

export type AgentResult = {
  taskId: string;
  agentId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  message: string;
  artifacts?: Array<{ name: string; uri?: string; description?: string }>;
  metadata?: Record<string, unknown>;
};

export type AdapterErrorCode =
  | "PROVIDER_NOT_INSTALLED"
  | "AUTH_REQUIRED"
  | "SESSION_NOT_FOUND"
  | "SESSION_CREATE_UNSUPPORTED"
  | "RESUME_UNSUPPORTED"
  | "ATTACH_UNSUPPORTED"
  | "WORKSPACE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "INTERACTIVE_APPROVAL_REQUIRED"
  | "PERMISSION_RESTORE_FAILED"
  | "OUTPUT_PARSE_FAILED"
  | "TIMEOUT"
  | "CANCEL_UNSUPPORTED"
  | "PROCESS_EXITED"
  | "PROVIDER_UNAVAILABLE"
  | "UNVERIFIED_INTEGRATION"
  | "INVALID_REQUEST"
  | "NO_AGENT_AVAILABLE"
  | "CYCLE_DETECTED"
  | "MAX_DEPTH_EXCEEDED";

export type AdapterError = {
  code: AdapterErrorCode;
  provider: string;
  message: string;
  retryable: boolean;
};

export type AgentTaskRecord = {
  task: AgentTask;
  state: TaskState;
  updatedAt: number;
  result?: AgentResult;
  error?: AdapterError;
};

export type A2ARuntimeSnapshot = {
  rooms: AgentRoom[];
  agents: AgentNode[];
  sessions: Array<{ agentId: string; session: NativeSession }>;
  histories: Array<{ agentId: string; entries: AgentHistoryEntry[] }>;
  tasks: AgentTaskRecord[];
};

export type AgentSelector = {
  role?: string;
  capabilities?: string[];
  workspace?: string;
  provider?: string;
};

export type A2ATaskSubmission = {
  roomId: string;
  targetAgent?: string;
  /** Resolve a provider-visible session name before falling back to targetAgent. */
  targetSessionName?: string;
  selector?: AgentSelector;
  message: string;
  timeoutMs?: number;
  maxDepth?: number;
  metadata?: Record<string, unknown>;
};

export type RoutingPolicy = {
  allowExperimentalAdapters: boolean;
  allowQueueing: boolean;
  requireResumeCapability?: boolean;
  requireStructuredOutput?: boolean;
  requireCancellation?: boolean;
  maxDepth: number;
  defaultTimeoutMs: number;
};

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = Object.freeze({
  allowExperimentalAdapters: false,
  allowQueueing: true,
  maxDepth: 8,
  defaultTimeoutMs: 300_000,
});

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  if (from === to) return true;
  if (from === "QUEUED") return to === "RUNNING" || to === "FAILED" || to === "CANCELLED" || to === "TIMED_OUT";
  if (from === "RUNNING") return to === "WAITING" || to === "COMPLETED" || to === "FAILED" || to === "CANCELLED" || to === "TIMED_OUT";
  if (from === "WAITING") return to === "RUNNING" || to === "FAILED" || to === "CANCELLED" || to === "TIMED_OUT";
  return false;
}

export function canTransitionAgent(from: AgentState, to: AgentState): boolean {
  if (from === to) return true;
  if (from === "IDLE") return to === "WORKING" || to === "OFFLINE" || to === "ERROR";
  if (from === "WORKING") return to === "IDLE" || to === "WAITING" || to === "OFFLINE" || to === "ERROR";
  if (from === "WAITING") return to === "WORKING" || to === "IDLE" || to === "OFFLINE" || to === "ERROR";
  if (from === "ERROR") return to === "IDLE" || to === "OFFLINE";
  return to === "IDLE" || to === "ERROR";
}

/** Validate persisted JSON without trusting its TypeScript origin. */
export function isA2ARuntimeSnapshot(value: unknown): value is A2ARuntimeSnapshot {
  if (!isRecord(value) || !Array.isArray(value.rooms) || !Array.isArray(value.agents) ||
      !Array.isArray(value.sessions) || !Array.isArray(value.histories) || !Array.isArray(value.tasks)) return false;
  const roomIds = new Set<string>();
  for (const room of value.rooms) {
    if (!isRecord(room) || !nonEmpty(room.roomId) || typeof room.name !== "string" ||
        !Array.isArray(room.agentIds) || room.agentIds.some((id) => typeof id !== "string") ||
        !finiteNumber(room.createdAt) || roomIds.has(room.roomId)) return false;
    roomIds.add(room.roomId);
  }
  const agentIds = new Set<string>();
  for (const agent of value.agents) {
    if (!isRecord(agent) || !nonEmpty(agent.agentId) || !nonEmpty(agent.provider) || !nonEmpty(agent.adapterId) ||
        !nonEmpty(agent.nativeSessionId) || !isAgentState(agent.state) || !Array.isArray(agent.capabilities) ||
        agent.capabilities.some((capability) => typeof capability !== "string") || !finiteNumber(agent.lastActivityAt) ||
        (agent.role !== undefined && typeof agent.role !== "string") ||
        (agent.sessionName !== undefined && typeof agent.sessionName !== "string") ||
        (agent.workspace !== undefined && typeof agent.workspace !== "string") ||
        (agent.currentTaskId !== undefined && typeof agent.currentTaskId !== "string") ||
        (agent.offlineReason !== undefined && agent.offlineReason !== "SESSION_UNAVAILABLE" &&
          agent.offlineReason !== "ADAPTER_UNAVAILABLE" && agent.offlineReason !== "PROCESS_TERMINATED") || agentIds.has(agent.agentId)) return false;
    agentIds.add(agent.agentId);
  }
  const sessionAgentIds = new Set<string>();
  for (const entry of value.sessions) {
    if (!isRecord(entry) || !nonEmpty(entry.agentId) || !isNativeSessionValue(entry.session) ||
        !agentIds.has(entry.agentId) || sessionAgentIds.has(entry.agentId)) return false;
    sessionAgentIds.add(entry.agentId);
  }
  if ([...agentIds].some((id) => !sessionAgentIds.has(id))) return false;
  const historyAgentIds = new Set<string>();
  for (const history of value.histories) {
    if (!isRecord(history) || !nonEmpty(history.agentId) || !agentIds.has(history.agentId) || historyAgentIds.has(history.agentId) ||
        !Array.isArray(history.entries) || history.entries.some((entry) =>
          !isRecord(entry) || !nonEmpty(entry.taskId) ||
          (entry.role !== "user" && entry.role !== "assistant") || typeof entry.message !== "string" || !finiteNumber(entry.createdAt))) return false;
    historyAgentIds.add(history.agentId);
  }
  const roomAgents = new Set<string>();
  for (const room of value.rooms) {
    if (room.agentIds.some((id: string) => !agentIds.has(id))) return false;
    for (const id of room.agentIds) roomAgents.add(`${room.roomId}\u0000${id}`);
  }
  const taskIds = new Set<string>();
  const tasks = new Map<string, AgentTaskRecord>();
  for (const record of value.tasks) {
    if (!isRecord(record) || !isTaskRecord(record) || !roomIds.has(record.task.roomId) ||
        !agentIds.has(record.task.targetAgent) || taskIds.has(record.task.taskId)) return false;
    taskIds.add(record.task.taskId);
    tasks.set(record.task.taskId, record);
  }
  for (const record of tasks.values()) {
    const parentTaskId = record.task.parentTaskId;
    if (!parentTaskId) {
      if (record.task.depth !== 0 || record.task.rootTaskId !== record.task.taskId ||
          (record.task.sourceAgent !== "orchestrator" && !roomAgents.has(`${record.task.roomId}\u0000${record.task.sourceAgent}`))) return false;
      continue;
    }
    const parent = tasks.get(parentTaskId);
    if (!parent || parent.task.rootTaskId !== record.task.rootTaskId || parent.task.roomId !== record.task.roomId ||
        parent.task.depth + 1 !== record.task.depth || parent.task.targetAgent !== record.task.sourceAgent ||
        parent.task.visitedAgents.some((agentId, index) => record.task.visitedAgents[index] !== agentId)) return false;
  }
  return true;
}

function isTaskRecord(value: unknown): value is AgentTaskRecord {
  if (!isRecord(value)) return false;
  const task = value.task;
  const visitedAgents = isRecord(task) && Array.isArray(task.visitedAgents) ? task.visitedAgents : [];
  const validVisitedPath = isRecord(task) && typeof task.depth === "number" && visitedAgents.length === task.depth + 1;
  const legacyNativeRootVisitedPath = isRecord(task) && task.parentTaskId === undefined && task.depth === 0 &&
    task.sourceAgent !== "orchestrator" && visitedAgents.length === 2 &&
    visitedAgents[0] === task.sourceAgent && visitedAgents[1] === task.targetAgent;
  if (!isRecord(task) || !nonEmpty(task.taskId) || !nonEmpty(task.rootTaskId) || !nonEmpty(task.roomId) ||
      typeof task.sourceAgent !== "string" || !nonEmpty(task.targetAgent) ||
      (task.type !== "REQUEST" && task.type !== "RESULT" && task.type !== "ERROR" && task.type !== "CANCEL") ||
      typeof task.message !== "string" || typeof task.depth !== "number" || !Number.isSafeInteger(task.depth) || task.depth < 0 ||
      typeof task.maxDepth !== "number" || !Number.isSafeInteger(task.maxDepth) || task.maxDepth < task.depth || task.maxDepth > 64 ||
      typeof task.timeoutMs !== "number" || !Number.isSafeInteger(task.timeoutMs) || task.timeoutMs <= 0 || !finiteNumber(task.createdAt) ||
      !Array.isArray(task.visitedAgents) || task.visitedAgents.some((agentId) => typeof agentId !== "string") ||
      (!validVisitedPath && !legacyNativeRootVisitedPath) || task.visitedAgents.at(-1) !== task.targetAgent ||
      new Set(task.visitedAgents).size !== task.visitedAgents.length ||
      (task.parentTaskId !== undefined && typeof task.parentTaskId !== "string") ||
      (task.metadata !== undefined && !isRecord(task.metadata))) return false;
  if (!isTaskState(value.state) || !finiteNumber(value.updatedAt)) return false;
  if (value.result !== undefined) {
    const result = value.result;
    if (!isRecord(result) || result.taskId !== task.taskId || result.agentId !== task.targetAgent ||
        typeof result.message !== "string" ||
        (result.status !== "COMPLETED" && result.status !== "FAILED" && result.status !== "CANCELLED" && result.status !== "TIMED_OUT") ||
        (result.artifacts !== undefined && (!Array.isArray(result.artifacts) || result.artifacts.some((item) =>
          !isRecord(item) || typeof item.name !== "string" || (item.uri !== undefined && typeof item.uri !== "string") ||
          (item.description !== undefined && typeof item.description !== "string")))) ||
        (result.metadata !== undefined && !isRecord(result.metadata))) return false;
  }
  if (value.error !== undefined) {
    const error = value.error;
    if (!isRecord(error) || typeof error.code !== "string" || !nonEmpty(error.provider) ||
        typeof error.message !== "string" || typeof error.retryable !== "boolean") return false;
  }
  return true;
}

function isNativeSessionValue(value: unknown): value is NativeSession {
  if (!isRecord(value)) return false;
  return nonEmpty(value.sessionId) && nonEmpty(value.provider) &&
    (value.sessionName === undefined || typeof value.sessionName === "string") &&
    (value.workspace === undefined || typeof value.workspace === "string") &&
    (value.persistenceLevel === 0 || value.persistenceLevel === 1 || value.persistenceLevel === 2 || value.persistenceLevel === 3) &&
    typeof value.runtimeManagedHistory === "boolean" && (value.persistenceLevel !== 1 || value.runtimeManagedHistory);
}

function isAgentState(value: unknown): value is AgentState {
  return value === "IDLE" || value === "WORKING" || value === "WAITING" || value === "ERROR" || value === "OFFLINE";
}

function isTaskState(value: unknown): value is TaskState {
  return value === "QUEUED" || value === "RUNNING" || value === "WAITING" || value === "COMPLETED" ||
    value === "FAILED" || value === "CANCELLED" || value === "TIMED_OUT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
