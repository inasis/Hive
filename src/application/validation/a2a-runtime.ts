import { isA2ARuntimeSnapshot, type A2ARuntimeSnapshot } from "../../domain/a2a.js";
import type {
  AdapterError,
  AdapterErrorCode,
  AdapterCapabilities,
  AgentNode,
  AgentResult,
  AgentRoom,
  AgentSummary,
  AgentTaskRecord,
  NativeSession,
  RoutingPolicy,
  TaskState,
} from "../../domain/a2a.js";
import type { A2ARuntimeEvent, AgentAdapterDescriptor } from "../ports/a2a-runtime.js";
import type { A2ATaskSubmission } from "../../domain/a2a.js";

export class A2ARuntimeFault extends Error {
  constructor(readonly detail: AdapterError) {
    super(detail.message);
    this.name = "A2ARuntimeFault";
  }
}

export function validatePolicy(policy: RoutingPolicy): void {
  if (!Number.isSafeInteger(policy.maxDepth) || policy.maxDepth < 0 || policy.maxDepth > 64) {
    throw new Error("A2A maxDepth policy must be an integer from 0 to 64");
  }
  if (!Number.isSafeInteger(policy.defaultTimeoutMs) || policy.defaultTimeoutMs <= 0) {
    throw new Error("A2A defaultTimeoutMs policy must be a positive integer");
  }
  for (const value of [policy.allowExperimentalAdapters, policy.allowQueueing]) {
    if (typeof value !== "boolean") throw new Error("A2A routing policy flags must be boolean");
  }
  for (const value of [policy.requireResumeCapability, policy.requireStructuredOutput, policy.requireCancellation]) {
    if (value !== undefined && typeof value !== "boolean") throw new Error("A2A routing capability requirements must be boolean");
  }
}

export function validateAdapterDescriptor(descriptor: AgentAdapterDescriptor): void {
  requireNonEmpty(descriptor.provider, "provider");
  const expectedCapabilities: Array<keyof AdapterCapabilities> = [
    "discoverSessions", "attachExistingProcess", "resumeSession", "persistentContext", "structuredOutput",
    "streaming", "cancellation", "toolCalling", "fileAccess", "shellAccess", "delegation", "concurrentTasks",
  ];
  if (!isRecord(descriptor.capabilities) || expectedCapabilities.some((key) => typeof descriptor.capabilities[key] !== "boolean")) {
    throw new Error("Adapter capabilities must be explicit boolean values");
  }
  if (descriptor.integrationStatus !== "VERIFIED" && descriptor.integrationStatus !== "PARTIALLY_VERIFIED" &&
      descriptor.integrationStatus !== "EXPERIMENTAL" && descriptor.integrationStatus !== "UNAVAILABLE" &&
      descriptor.integrationStatus !== "MANUAL_CONFIGURATION_REQUIRED") throw new Error("Adapter integration status is invalid");
  if (!isRecord(descriptor.evidence) || typeof descriptor.evidence.verifiedAt !== "string" ||
      (descriptor.evidence.source !== "official-sdk" && descriptor.evidence.source !== "official-api" &&
        descriptor.evidence.source !== "official-cli" && descriptor.evidence.source !== "documented-command" &&
        descriptor.evidence.source !== "observed-cli" && descriptor.evidence.source !== "pty" &&
        descriptor.evidence.source !== "local-state" && descriptor.evidence.source !== "hive-provider-port" &&
        descriptor.evidence.source !== "unsupported") ||
      !Array.isArray(descriptor.evidence.limitations) || descriptor.evidence.limitations.some((item) => typeof item !== "string") ||
      (descriptor.evidence.verifiedVersion !== undefined && typeof descriptor.evidence.verifiedVersion !== "string") ||
      (descriptor.evidence.confidence !== "high" && descriptor.evidence.confidence !== "medium" && descriptor.evidence.confidence !== "low")) {
    throw new Error("Adapter integration evidence is invalid");
  }
  if (descriptor.evidence.source === "unsupported" && descriptor.integrationStatus !== "UNAVAILABLE" &&
      descriptor.integrationStatus !== "MANUAL_CONFIGURATION_REQUIRED") {
    throw new Error("Unsupported integration evidence cannot be marked routable");
  }
  if (descriptor.evidence.confidence === "low" && descriptor.integrationStatus === "VERIFIED") {
    throw new Error("Low-confidence integration evidence cannot be marked verified");
  }
}

export function validateSubmission(input: A2ATaskSubmission): void {
  if (!isRecord(input)) throw runtimeFault("INVALID_REQUEST", "", "Task request must be an object");
  requireNonEmpty(input.roomId, "roomId");
  requireNonEmpty(input.message, "message");
  if (input.targetAgent !== undefined) requireNonEmpty(input.targetAgent, "targetAgent");
  if (input.targetSessionName !== undefined) {
    requireNonEmpty(input.targetSessionName, "targetSessionName");
    if (input.targetSessionName.trim().length > 120) {
      throw runtimeFault("INVALID_REQUEST", "", "targetSessionName must be 120 characters or fewer");
    }
  }
  if (input.selector !== undefined) {
    if (!isRecord(input.selector)) throw runtimeFault("INVALID_REQUEST", "", "Agent selector must be an object");
    const allowed = new Set(["role", "capabilities", "workspace", "provider"]);
    if (Object.keys(input.selector).some((key) => !allowed.has(key))) throw runtimeFault("INVALID_REQUEST", "", "Agent selector contains an unsupported field");
    const optionalFields: Array<"role" | "workspace" | "provider"> = ["role", "workspace", "provider"];
    for (const field of optionalFields) {
      const value = input.selector[field];
      if (value !== undefined) requireNonEmpty(value, `selector.${field}`);
    }
    if (input.selector.capabilities !== undefined &&
        (!Array.isArray(input.selector.capabilities) || input.selector.capabilities.some((item) => typeof item !== "string" || !item.trim()))) {
      throw runtimeFault("INVALID_REQUEST", "", "selector.capabilities must be a list of non-empty strings");
    }
  }
  if (input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0)) {
    throw runtimeFault("INVALID_REQUEST", "", "timeoutMs must be a positive integer");
  }
  if (input.maxDepth !== undefined && (!Number.isSafeInteger(input.maxDepth) || input.maxDepth < 0)) {
    throw runtimeFault("INVALID_REQUEST", "", "maxDepth must be a non-negative integer");
  }
  if (input.metadata !== undefined && !isRecord(input.metadata)) throw runtimeFault("INVALID_REQUEST", "", "metadata must be an object");
}

export function validateNativeSession(value: NativeSession): void {
  if (!isNativeSession(value)) throw runtimeFault("INVALID_REQUEST", "", "Native session descriptor is invalid");
}

export function sessionCapabilityError(session: NativeSession, descriptor: AgentAdapterDescriptor): AdapterErrorCode | undefined {
  if (session.persistenceLevel === 1 && !descriptor.capabilities.persistentContext) return "UNVERIFIED_INTEGRATION";
  if (session.persistenceLevel === 2 && (!descriptor.capabilities.persistentContext || !descriptor.capabilities.resumeSession)) {
    return "RESUME_UNSUPPORTED";
  }
  if (session.persistenceLevel === 3 && (!descriptor.capabilities.persistentContext || !descriptor.capabilities.attachExistingProcess)) return "ATTACH_UNSUPPORTED";
  return undefined;
}

export function isNativeSession(value: unknown): value is NativeSession {
  if (!isRecord(value)) return false;
  const level = value.persistenceLevel;
  return typeof value.sessionId === "string" && value.sessionId.length > 0 &&
    typeof value.provider === "string" && value.provider.length > 0 &&
    (value.sessionName === undefined || typeof value.sessionName === "string") &&
    (value.workspace === undefined || typeof value.workspace === "string") &&
    (level === 0 || level === 1 || level === 2 || level === 3) &&
    typeof value.runtimeManagedHistory === "boolean" && (level !== 1 || value.runtimeManagedHistory);
}

export function parseAgentResult(value: unknown, taskId: string, agentId: string): AgentResult {
  if (!isAgentResult(value) || value.taskId !== taskId || value.agentId !== agentId) {
    throw runtimeFault("OUTPUT_PARSE_FAILED", "", "Adapter returned an invalid A2A result");
  }
  return value;
}

export async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal, didTimeout: () => boolean): Promise<T> {
  if (signal.aborted) throw didTimeout() ? runtimeFault("TIMEOUT", "", "Task timed out", true) : runtimeFault("PROCESS_EXITED", "", "Task was cancelled");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(didTimeout()
      ? runtimeFault("TIMEOUT", "", "Task timed out", true)
      : runtimeFault("PROCESS_EXITED", "", "Task was cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function normalizeAdapterError(error: unknown, provider: string): AdapterError {
  if (error instanceof A2ARuntimeFault) return { ...error.detail, provider: error.detail.provider || provider };
  if (isRecord(error) && isAdapterErrorCode(error.code)) {
    return {
      code: error.code,
      provider: typeof error.provider === "string" && error.provider ? error.provider : provider,
      message: typeof error.message === "string" ? error.message : "Agent adapter failed",
      retryable: error.retryable === true,
    };
  }
  return runtimeFault("PROVIDER_UNAVAILABLE", provider, "Agent adapter failed", true).detail;
}

export function runtimeFault(code: AdapterErrorCode, provider: string, message: string, retryable = false): A2ARuntimeFault {
  return new A2ARuntimeFault({ code, provider, message, retryable });
}

export function validateSnapshot(snapshot: unknown): asserts snapshot is A2ARuntimeSnapshot {
  if (!isA2ARuntimeSnapshot(snapshot)) throw new Error("A2A runtime state store returned an invalid snapshot");
  const sessions = new Map(snapshot.sessions.map(({ agentId, session }) => [agentId, session]));
  for (const agent of snapshot.agents) {
    const session = sessions.get(agent.agentId);
    if (!session || session.sessionId !== agent.nativeSessionId || session.provider !== agent.provider) {
      throw new Error("A2A runtime agent and native session mappings do not match");
    }
  }
  for (const { agentId } of snapshot.histories) {
    const session = sessions.get(agentId);
    if (!session || session.persistenceLevel !== 1 || !session.runtimeManagedHistory) {
      throw new Error("A2A runtime history is attached to a session without runtime-managed history");
    }
  }
  const roomMemberships = new Set<string>();
  for (const room of snapshot.rooms) {
    for (const agentId of room.agentIds) {
      const key = `${room.roomId}\u0000${agentId}`;
      if (roomMemberships.has(key)) throw new Error("A2A room contains a duplicate agent");
      roomMemberships.add(key);
    }
  }
}

export function isTerminalTask(state: TaskState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED" || state === "TIMED_OUT";
}

export function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw runtimeFault("INVALID_REQUEST", "", `${field} must be a non-empty string`);
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function copyRoom(room: AgentRoom): AgentRoom {
  return { ...room, agentIds: [...room.agentIds] };
}

export function copyAgent(agent: AgentNode): AgentNode {
  return { ...agent, capabilities: [...agent.capabilities] };
}

export function copyAgentSummary(agent: AgentNode): AgentSummary {
  const { adapterId: _adapterId, nativeSessionId: _nativeSessionId, ...summary } = agent;
  return { ...summary, capabilities: [...summary.capabilities] };
}

export function copyTaskRecord(record: AgentTaskRecord): AgentTaskRecord {
  return {
    ...record,
    task: {
      ...record.task,
      visitedAgents: [...record.task.visitedAgents],
      ...(record.task.metadata ? { metadata: { ...record.task.metadata } } : {}),
    },
    ...(record.result ? {
      result: {
        ...record.result,
        ...(record.result.artifacts ? { artifacts: record.result.artifacts.map((artifact) => ({ ...artifact })) } : {}),
        ...(record.result.metadata ? { metadata: { ...record.result.metadata } } : {}),
      },
    } : {}),
    ...(record.error ? { error: { ...record.error } } : {}),
  };
}

export function copyDescriptor(descriptor: AgentAdapterDescriptor): AgentAdapterDescriptor {
  return {
    ...descriptor,
    adapterId: descriptor.adapterId,
    capabilities: { ...descriptor.capabilities },
    evidence: { ...descriptor.evidence, limitations: [...descriptor.evidence.limitations] },
  };
}

export function copyEvent(event: A2ARuntimeEvent): A2ARuntimeEvent {
  if (event.type === "room.updated") return { ...event, room: copyRoom(event.room) };
  if (event.type === "agent.updated") return { ...event, agent: { ...event.agent, capabilities: [...event.agent.capabilities] } };
  return { ...event, task: copyTaskRecord(event.task) };
}

function isAgentResult(value: unknown): value is AgentResult {
  if (!isRecord(value) || typeof value.taskId !== "string" || typeof value.agentId !== "string" ||
      typeof value.message !== "string" ||
      (value.status !== "COMPLETED" && value.status !== "FAILED" && value.status !== "CANCELLED" && value.status !== "TIMED_OUT")) return false;
  if (value.artifacts !== undefined && (!Array.isArray(value.artifacts) || value.artifacts.some((item) =>
    !isRecord(item) || typeof item.name !== "string" ||
    (item.uri !== undefined && typeof item.uri !== "string") ||
    (item.description !== undefined && typeof item.description !== "string")))) return false;
  return value.metadata === undefined || isRecord(value.metadata);
}

function isAdapterErrorCode(value: unknown): value is AdapterErrorCode {
  return typeof value === "string" && [
    "PROVIDER_NOT_INSTALLED", "AUTH_REQUIRED", "SESSION_NOT_FOUND", "SESSION_CREATE_UNSUPPORTED", "RESUME_UNSUPPORTED", "ATTACH_UNSUPPORTED",
    "WORKSPACE_NOT_FOUND", "PERMISSION_DENIED", "INTERACTIVE_APPROVAL_REQUIRED", "PERMISSION_RESTORE_FAILED", "OUTPUT_PARSE_FAILED", "TIMEOUT",
    "CANCEL_UNSUPPORTED", "PROCESS_EXITED", "PROVIDER_UNAVAILABLE", "UNVERIFIED_INTEGRATION", "INVALID_REQUEST",
    "NO_AGENT_AVAILABLE", "CYCLE_DETECTED", "MAX_DEPTH_EXCEEDED",
  ].includes(value);
}
