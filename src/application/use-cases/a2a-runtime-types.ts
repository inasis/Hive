import type { AdapterErrorCode } from "../../domain/a2a-adapter.js";
import type {
  A2AAgentSummaryDto,
  A2ARegisterAgentDto,
  A2ARoutingPolicyDto,
  A2ATaskSubmissionDto,
} from "../dto/a2a-collaboration.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import type { RoomRepository } from "../../domain/collaboration/repositories/room-repository.js";
import type { A2ATaskSnapshotSource } from "../ports/a2a-task-snapshot-source.js";
import type { AssistantEventPublisher } from "../ports/events.js";
import type {
  A2ARuntimeStateStore,
  A2AWorkspaceLockPort,
} from "../ports/a2a-runtime.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { SessionIdentityPort } from "../ports/session-identities.js";
import type { TimerPort } from "../ports/timers.js";

export type A2ARuntimeDependencies = {
  adapters: readonly AgentAdapter[];
  stateStore: A2ARuntimeStateStore;
  taskRepository: TaskRepository;
  taskSnapshotSource?: A2ATaskSnapshotSource;
  agentRepository: AgentRepository;
  roomRepository: RoomRepository;
  workspaceLocks: A2AWorkspaceLockPort;
  timers: TimerPort;
  sessionIdentities?: SessionIdentityPort;
  createId: (kind: "task" | "agent" | "session") => string;
  now: () => number;
  publishAssistantEvent?: AssistantEventPublisher;
  policy?: Partial<A2ARoutingPolicyDto>;
};

export type RegisterAgentInput = A2ARegisterAgentDto;

export type AgentProfileUpdate = {
  role?: string | null;
  capabilities?: string[];
};

export type SubmitAgentTaskInput = A2ATaskSubmissionDto;

export type DiscoveryResult = {
  registered: A2AAgentSummaryDto[];
  skipped: Array<{ adapterId: string; code: AdapterErrorCode }>;
};
