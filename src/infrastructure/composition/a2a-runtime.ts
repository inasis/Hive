import { randomUUID } from "node:crypto";
import type { A2ARuntimeStateStore } from "../../application/ports/a2a-runtime.js";
import type { AgentAdapter } from "../../application/ports/a2a-agent-adapter.js";
import { A2ARuntime } from "../../application/use-cases/a2a-runtime.js";
import type { A2ARuntimeDependencies } from "../../application/use-cases/a2a-runtime-types.js";
import type { A2ARoutingPolicyDto } from "../../application/dto/a2a-collaboration.js";
import type { AssistantEventPublisher } from "../../application/ports/events.js";
import { FileA2ARuntimeStateStore } from "../persistence/a2a-file-state.js";
import { InMemoryA2ARuntimeStateStore } from "../persistence/a2a-runtime-state.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import type { RoomRepository } from "../../domain/collaboration/repositories/room-repository.js";
import { A2ACollaborationSnapshotStore } from "../persistence/a2a-collaboration-snapshot-store.js";
import { SnapshotAgentRepository, SnapshotRoomRepository, SnapshotTaskRepository } from "../persistence/a2a-collaboration-repositories.js";
import { InMemoryA2AWorkspaceLockManager } from "../workspace/a2a-locks.js";
import type { A2AWorkspaceLockPort } from "../../application/ports/a2a-runtime.js";
import type { SessionIdentityPort } from "../../application/ports/session-identities.js";
import type { TimerPort } from "../../application/ports/timers.js";
import type { A2ATaskSnapshotSource } from "../../application/ports/a2a-task-snapshot-source.js";
import { SystemTimerAdapter } from "../runtime/system-timers.js";

export type A2ARuntimeCompositionOptions = {
  adapters: readonly AgentAdapter[];
  stateStore?: A2ARuntimeStateStore;
  taskRepository?: TaskRepository;
  taskSnapshotSource?: A2ATaskSnapshotSource;
  agentRepository?: AgentRepository;
  roomRepository?: RoomRepository;
  workspaceLocks?: A2AWorkspaceLockPort;
  timers?: TimerPort;
  stateFilePath?: string;
  sessionIdentities?: SessionIdentityPort;
  policy?: Partial<A2ARoutingPolicyDto>;
  publishAssistantEvent?: AssistantEventPublisher;
};

/** Node composition root; transport and provider adapters are supplied by the host application. */
export function createA2ARuntime(options: A2ARuntimeCompositionOptions): A2ARuntime {
  if (options.stateStore && options.stateFilePath) throw new Error("Choose either stateStore or stateFilePath");
  const collaborationStore = new A2ACollaborationSnapshotStore(options.stateStore ?? (options.stateFilePath !== undefined
    ? new FileA2ARuntimeStateStore(options.stateFilePath)
    : new InMemoryA2ARuntimeStateStore()));
  const dependencies: A2ARuntimeDependencies = {
    adapters: options.adapters,
    stateStore: collaborationStore,
    taskRepository: options.taskRepository ?? new SnapshotTaskRepository(collaborationStore),
    ...(options.taskSnapshotSource ? { taskSnapshotSource: options.taskSnapshotSource } : {}),
    agentRepository: options.agentRepository ?? new SnapshotAgentRepository(collaborationStore),
    roomRepository: options.roomRepository ?? new SnapshotRoomRepository(collaborationStore),
    ...(options.sessionIdentities ? { sessionIdentities: options.sessionIdentities } : {}),
    workspaceLocks: options.workspaceLocks ?? new InMemoryA2AWorkspaceLockManager(),
    timers: options.timers ?? new SystemTimerAdapter(),
    createId: (kind) => kind === "session" ? randomUUID() : `${kind}-${randomUUID()}`,
    now: () => Date.now(),
    ...(options.publishAssistantEvent ? { publishAssistantEvent: options.publishAssistantEvent } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
  };
  return new A2ARuntime(dependencies);
}
