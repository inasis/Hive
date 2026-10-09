export type A2AAgentHistoryEntryDto = {
  taskId: string;
  role: "user" | "assistant";
  message: string;
  createdAt: number;
};

export type A2AAgentSelectorDto = {
  role?: string;
  capabilities?: string[];
  workspace?: string;
  provider?: string;
};

export type A2AAgentPermissionProfileDto = {
  provider: string;
  profile: string;
};

export type A2ACommunicationPermissionsDto = {
  a2a: boolean;
  a2b: boolean;
};

export type A2AAdapterCapabilitiesDto = {
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

export type A2AIntegrationEvidenceDto = {
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

export type A2AIntegrationStatusDto =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "EXPERIMENTAL"
  | "UNAVAILABLE"
  | "MANUAL_CONFIGURATION_REQUIRED";

export type A2AAgentAdapterDescriptorDto = {
  readonly adapterId: string;
  readonly provider: string;
  readonly integrationStatus: A2AIntegrationStatusDto;
  readonly capabilities: Readonly<A2AAdapterCapabilitiesDto>;
  readonly evidence: A2AIntegrationEvidenceDto;
};

/** Runtime configuration supplied to the collaboration Application layer. */
export type A2ARoutingPolicyDto = {
  allowExperimentalAdapters: boolean;
  allowQueueing: boolean;
  requireResumeCapability?: boolean;
  requireStructuredOutput?: boolean;
  requireCancellation?: boolean;
  maxDepth: number;
  defaultTimeoutMs: number;
};

export type A2AAgentSessionToolRequestDto = {
  interaction?: "A2A" | "A2B";
  targetAgent?: string;
  targetSessionName?: string;
  selector?: A2AAgentSelectorDto;
  message: string;
  timeoutMs?: number;
  responseForTaskId?: string;
  callbackForTaskId?: string;
};

export type A2AAgentInputDto = {
  task: A2ATaskDto;
  message: string;
};

export type PersistenceLevel = 0 | 1 | 2 | 3;
export type NativeSession = {
  sessionId: string;
  callerAgentId?: string;
  provider: string;
  sessionName?: string;
  workspace?: string;
  persistenceLevel: PersistenceLevel;
  runtimeManagedHistory: boolean;
};

/** Application projection combining collaboration-facing agent data with provider routing details. */
export type AgentNode = A2AAgentSummaryDto & {
  adapterId: string;
  nativeSessionId: string;
};
export type AgentSummary = A2AAgentSummaryDto;
export type AgentRoom = A2ARoomDto;

export type A2AAgentSummaryDto = {
  agentId: string;
  callerAgentId?: string;
  provider: string;
  role?: string;
  capabilities: string[];
  state: "IDLE" | "WORKING" | "WAITING" | "ERROR" | "OFFLINE";
  currentTaskId?: string;
  sessionName?: string;
  workspace?: string;
  lastActivityAt: number;
  offlineReason?: "SESSION_UNAVAILABLE" | "ADAPTER_UNAVAILABLE" | "PROCESS_TERMINATED";
};

/** Internal registration result retains the existing runtime detail fields. */
export type A2ARegisteredAgentDto = A2AAgentSummaryDto & {
  adapterId: string;
  nativeSessionId: string;
};

export type A2ARoomDto = {
  roomId: string;
  name: string;
  agentIds: string[];
  createdAt: number;
};

export type A2ANativeSessionDto = {
  sessionId: string;
  callerAgentId?: string;
  provider: string;
  sessionName?: string;
  workspace?: string;
  persistenceLevel: 0 | 1 | 2 | 3;
  runtimeManagedHistory: boolean;
};

export type A2ARegisterAgentDto = {
  agentId: string;
  adapterId: string;
  session: A2ANativeSessionDto;
  role?: string;
  capabilities?: string[];
};

export type A2ATaskStateDto = "QUEUED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
export type A2ATaskDto = {
  taskId: string;
  rootTaskId: string;
  parentTaskId?: string;
  roomId: string;
  sourceAgent: string;
  targetAgent: string;
  type: "REQUEST" | "RESULT" | "ERROR" | "CANCEL";
  message: string;
  depth: number;
  maxDepth: number;
  timeoutMs: number;
  createdAt: number;
  visitedAgents: string[];
  metadata?: Record<string, unknown>;
};

export type A2ATaskResultDto = {
  taskId: string;
  agentId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  message: string;
  artifacts?: Array<{ name: string; uri?: string; description?: string }>;
  metadata?: Record<string, unknown>;
};

export type A2ATaskErrorDto = {
  code:
    | "PROVIDER_NOT_INSTALLED" | "AUTH_REQUIRED" | "SESSION_NOT_FOUND" | "SESSION_CREATE_UNSUPPORTED"
    | "RESUME_UNSUPPORTED" | "ATTACH_UNSUPPORTED" | "WORKSPACE_NOT_FOUND" | "PERMISSION_DENIED"
    | "INTERACTIVE_APPROVAL_REQUIRED" | "PERMISSION_RESTORE_FAILED" | "OUTPUT_PARSE_FAILED" | "TIMEOUT"
    | "CANCEL_UNSUPPORTED" | "PROCESS_EXITED" | "PROVIDER_UNAVAILABLE" | "UNVERIFIED_INTEGRATION"
    | "INVALID_REQUEST" | "NO_AGENT_AVAILABLE" | "CYCLE_DETECTED" | "MAX_DEPTH_EXCEEDED";
  provider: string;
  message: string;
  retryable: boolean;
};

export type A2ATaskRecordDto = {
  task: A2ATaskDto;
  state: A2ATaskStateDto;
  updatedAt: number;
  result?: A2ATaskResultDto;
  error?: A2ATaskErrorDto;
};

export type A2ATaskSubmissionDto = {
  roomId: string;
  targetAgent?: string;
  targetSessionName?: string;
  selector?: { role?: string; capabilities?: string[]; workspace?: string; provider?: string };
  message: string;
  timeoutMs?: number;
  maxDepth?: number;
  metadata?: Record<string, unknown>;
};

/** Task lineage and routing facts passed between collaboration use cases. */
export type A2ATaskAncestryDto = {
  parentTaskId?: string;
  flowParentTaskId?: string;
  sourceAgentId?: string;
  resolvedTargetAgentId?: string;
};

/** Task reference passed from scheduling to the task execution use case. */
export type A2ATaskExecutionRequestDto = {
  taskId: string;
};

export type A2ATaskWaitResultDto = {
  completed: boolean;
  taskId: string;
  state: A2ATaskStateDto;
  result?: A2ATaskResultDto;
  error?: A2ATaskErrorDto;
};
