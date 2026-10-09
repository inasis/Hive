import type { AdapterErrorCode } from "../../domain/a2a-adapter.js";
import type {
  A2AAgentHistoryEntryDto,
  A2AAgentSessionToolRequestDto,
  A2ACommunicationPermissionsDto,
} from "../dto/a2a-collaboration.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { A2ARuntimeSnapshot } from "../dto/a2a-runtime-snapshot.js";
import type {
  AgentAdapter,
  AgentAdapterDescriptor,
} from "./a2a-agent-adapter.js";
import type {
  A2AAgentSummaryDto,
  A2ARegisterAgentDto,
  A2ARegisteredAgentDto,
  A2ARoomDto,
  A2ATaskRecordDto,
  A2ATaskSubmissionDto,
  A2ATaskWaitResultDto,
} from "../dto/a2a-collaboration.js";

export type A2ATaskWaitResult = A2ATaskWaitResultDto;

export type A2APermissionSource = {
  agentId: string;
  provider: string;
  session: NativeSession;
  adapter: AgentAdapter;
};

/** Narrow directory queries used to execute and record tasks. */
export interface A2ATaskDirectoryPort {
  getSession(agentId: string): NativeSession | undefined;
  getAgentSummary(agentId: string): A2AAgentSummaryDto | undefined;
  addHistory(agentId: string, entries: readonly A2AAgentHistoryEntryDto[]): void;
}

/** Caller lookup used only when inheriting a task's effective permissions. */
export interface A2APermissionSourceDirectoryPort {
  getPermissionSource(agentId: string, roomId: string): A2APermissionSource | undefined;
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
  | { type: "room.updated"; room: A2ARoomDto }
  | { type: "agent.updated"; agent: A2AAgentSummaryDto }
  | { type: "task.updated"; task: A2ATaskRecordDto };

export type A2ARuntimeEventHandler = (event: A2ARuntimeEvent) => void;

export type A2ADiscoveryResult = {
  registered: A2AAgentSummaryDto[];
  skipped: Array<{ adapterId: string; code: AdapterErrorCode }>;
};

export type A2AAgentProfileUpdate = {
  role?: string | null;
  capabilities?: string[];
};

/** Transport-facing application port. HTTP, WebSocket, and local callers share these semantics. */
export interface A2ARuntimePort {
  listRooms(): A2ARoomDto[];
  listAgents(roomId: string): A2AAgentSummaryDto[];
  listAgentsForAgent(agentId: string): A2AAgentSummaryDto[];
  /** Discover sessions in the caller agent's room without exposing room lookup to provider transports. */
  ensureSessionsDiscoveredForAgent(agentId: string): Promise<void>;
  findAgentForNativeSession(provider: string, nativeSessionId: string): A2AAgentSummaryDto | undefined;
  resolveNativeSessionAgent(provider: string, nativeSessionId: string): Promise<A2AAgentSummaryDto | undefined>;
  findActiveAgentForTarget(provider: string, target: string): Promise<A2AAgentSummaryDto | undefined>;
  resolveActiveAgentForTarget(provider: string, target: string): Promise<A2AAgentSummaryDto | undefined>;
  resolveActiveAgentForTask(provider: string, callerAgentId: string, nativeSessionId?: string): Promise<A2AAgentSummaryDto | undefined>;
  /** Apply the active persona's role-space permissions to a registered provider session. */
  setSessionCommunicationPermissions?(provider: string, nativeSessionId: string, permissions: A2ACommunicationPermissionsDto): Promise<void>;
  /** Persist an agent-originated request and return its accepted task record without waiting for completion. */
  sendFromNativeSession(provider: string, nativeSessionId: string, input: A2AAgentSessionToolRequestDto): Promise<A2ATaskRecordDto>;
  /** Resolve the caller, persist the request, and return its accepted task record without waiting for completion. */
  sendFromActiveSession(provider: string, target: string, input: A2AAgentSessionToolRequestDto): Promise<A2ATaskRecordDto>;
  /** Persist an agent-originated request or result callback and return once it is accepted. */
  sendFromAgent(agentId: string, input: A2AAgentSessionToolRequestDto): Promise<A2ATaskRecordDto>;
  /** Legacy compatibility read; native agents are not given this blocking operation. */
  waitForTask(taskId: string, waitMs?: number): Promise<A2ATaskWaitResult>;
  getTask(taskId: string): A2ATaskRecordDto | undefined;
  getTaskGraph(rootTaskId: string): A2ATaskRecordDto[];
  enqueueTask(input: A2ATaskSubmissionDto): Promise<A2ATaskRecordDto>;
  submitTask(input: A2ATaskSubmissionDto): Promise<A2ATaskRecordDto>;
  cancelTask(taskId: string): Promise<A2ATaskRecordDto>;
  subscribe(handler: A2ARuntimeEventHandler): () => void;
}

/** Minimal runtime operations used by provider-hosted A2A tools. */
export type A2AAgentToolRuntimePort = Pick<
  A2ARuntimePort,
  | "listAgentsForAgent"
  | "ensureSessionsDiscoveredForAgent"
  | "resolveNativeSessionAgent"
  | "resolveActiveAgentForTarget"
  | "resolveActiveAgentForTask"
  | "sendFromNativeSession"
  | "sendFromAgent"
  | "waitForTask"
>;

/** Administrative operations are kept distinct from the remote task transport surface. */
export interface A2ARuntimeAdminPort extends A2ARuntimePort {
  listAdapters(): AgentAdapterDescriptor[];
  createRoom(roomId: string, name: string): Promise<A2ARoomDto>;
  registerAgent(roomId: string, input: A2ARegisterAgentDto): Promise<A2ARegisteredAgentDto>;
  discoverSessions(roomId: string, adapterId?: string): Promise<A2ADiscoveryResult>;
  ensureSessionsDiscovered(roomId: string): Promise<void>;
  invalidateSessionDiscovery(): void;
  markNativeSessionUnavailable(provider: string, target: string, nativeSessionId: string): Promise<boolean>;
  refreshAvailability(roomId: string): Promise<A2AAgentSummaryDto[]>;
  updateAgentProfile(agentId: string, update: A2AAgentProfileUpdate): Promise<A2AAgentSummaryDto>;
}
