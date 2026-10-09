export type TaskState = "QUEUED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export type TaskErrorCode =
  | "PROVIDER_NOT_INSTALLED" | "AUTH_REQUIRED" | "SESSION_NOT_FOUND" | "SESSION_CREATE_UNSUPPORTED"
  | "RESUME_UNSUPPORTED" | "ATTACH_UNSUPPORTED" | "WORKSPACE_NOT_FOUND" | "PERMISSION_DENIED"
  | "INTERACTIVE_APPROVAL_REQUIRED" | "PERMISSION_RESTORE_FAILED" | "OUTPUT_PARSE_FAILED" | "TIMEOUT"
  | "CANCEL_UNSUPPORTED" | "PROCESS_EXITED" | "PROVIDER_UNAVAILABLE" | "UNVERIFIED_INTEGRATION"
  | "INVALID_REQUEST" | "NO_AGENT_AVAILABLE" | "CYCLE_DETECTED" | "MAX_DEPTH_EXCEEDED";

export type TaskError = { code: TaskErrorCode; provider: string; message: string; retryable: boolean };

const taskErrorCodes: readonly TaskErrorCode[] = [
  "PROVIDER_NOT_INSTALLED", "AUTH_REQUIRED", "SESSION_NOT_FOUND", "SESSION_CREATE_UNSUPPORTED",
  "RESUME_UNSUPPORTED", "ATTACH_UNSUPPORTED", "WORKSPACE_NOT_FOUND", "PERMISSION_DENIED",
  "INTERACTIVE_APPROVAL_REQUIRED", "PERMISSION_RESTORE_FAILED", "OUTPUT_PARSE_FAILED", "TIMEOUT",
  "CANCEL_UNSUPPORTED", "PROCESS_EXITED", "PROVIDER_UNAVAILABLE", "UNVERIFIED_INTEGRATION",
  "INVALID_REQUEST", "NO_AGENT_AVAILABLE", "CYCLE_DETECTED", "MAX_DEPTH_EXCEEDED",
];

export function isTaskErrorCode(value: unknown): value is TaskErrorCode {
  return typeof value === "string" && taskErrorCodes.includes(value as TaskErrorCode);
}

export function isTaskError(value: unknown): value is TaskError {
  return isRecord(value) && isTaskErrorCode(value.code) && typeof value.provider === "string" && value.provider.length > 0 &&
    typeof value.message === "string" && typeof value.retryable === "boolean";
}

export type TaskMessageType = "REQUEST" | "RESULT" | "ERROR" | "CANCEL";

export function isTaskState(value: unknown): value is TaskState {
  return value === "QUEUED" || value === "RUNNING" || value === "WAITING" || value === "COMPLETED" ||
    value === "FAILED" || value === "CANCELLED" || value === "TIMED_OUT";
}

export function isTaskMessageType(value: unknown): value is TaskMessageType {
  return value === "REQUEST" || value === "RESULT" || value === "ERROR" || value === "CANCEL";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  /** Milliseconds until automatic cancellation; 0 means no task deadline. */
  timeoutMs: number;
  createdAt: number;
  visitedAgents: string[];
  metadata?: Record<string, unknown>;
};

export type AgentInput = {
  task: AgentTask;
  message: string;
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

export type AgentTaskRecord = {
  task: AgentTask;
  state: TaskState;
  updatedAt: number;
  result?: AgentResult;
  error?: TaskError;
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
  /** Milliseconds until automatic cancellation; 0 means no task deadline. */
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
  defaultTimeoutMs: 0,
});

/** Return the remaining task deadline, or undefined when timeoutMs=0 disables the deadline. */
export function getRemainingTaskTimeoutMs(task: Pick<AgentTask, "timeoutMs" | "createdAt">, now: number): number | undefined {
  return task.timeoutMs === 0 ? undefined : task.timeoutMs - Math.max(0, now - task.createdAt);
}
