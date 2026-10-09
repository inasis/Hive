import type { AgentAggregate } from "../../domain/collaboration/aggregates/agent.js";
import type { RoomAggregate } from "../../domain/collaboration/aggregates/room.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import type { RoomRepository } from "../../domain/collaboration/repositories/room-repository.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import type { AgentId, RoomId, TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { A2ATaskRecordDto } from "../../application/dto/a2a-collaboration.js";
import type { A2ATaskSnapshotSource } from "../../application/ports/a2a-task-snapshot-source.js";
import { toA2ATaskRecordDto } from "../../application/mappers/a2a-collaboration-mapper.js";
import { A2ACollaborationSnapshotStore } from "./a2a-collaboration-snapshot-store.js";

/** Infrastructure Repository for Task roots stored in the existing runtime snapshot. */
export class SnapshotTaskRepository implements TaskRepository, A2ATaskSnapshotSource {
  private readonly tasks = new Map<string, TaskAggregate>();

  constructor(private readonly store: A2ACollaborationSnapshotStore) {}

  findById(id: TaskId): TaskAggregate | undefined { return this.tasks.get(id.value); }
  findByRootId(rootTaskId: TaskId): readonly TaskAggregate[] {
    return [...this.tasks.values()].filter((task) => task.rootId.equals(rootTaskId));
  }

  hasAcceptedResponseDelivery(taskId: TaskId): boolean {
    return [...this.tasks.values()].some((task) =>
      task.responseForTaskId?.equals(taskId) || task.callbackForTaskId?.equals(taskId));
  }

  hasCallbackForTask(taskId: TaskId): boolean {
    return [...this.tasks.values()].some((task) => task.callbackForTaskId?.equals(taskId));
  }

  countQueuedForTargetAgent(agentId: AgentId): number {
    return [...this.tasks.values()].filter((task) => task.targetAgentId.equals(agentId) && task.state === "QUEUED").length;
  }

  readTaskRecordsForSnapshot(): readonly A2ATaskRecordDto[] {
    return [...this.tasks.values()].map((task) => toA2ATaskRecordDto(task.toRecord()));
  }

  save(task: TaskAggregate): void {
    this.tasks.set(task.id.value, task);
    const record = toA2ATaskRecordDto(task.toRecord());
    this.store.updateSnapshot((snapshot) => {
      const index = snapshot.tasks.findIndex((entry) => entry.task.taskId === record.task.taskId);
      if (index >= 0 && JSON.stringify(snapshot.tasks[index]) === JSON.stringify(record)) return snapshot;
      const tasks = [...snapshot.tasks];
      if (index >= 0) tasks[index] = record;
      else tasks.push(record);
      return { ...snapshot, tasks };
    });
  }
}

/** Infrastructure Repository for Agent roots; provider/session fields remain snapshot projections. */
export class SnapshotAgentRepository implements AgentRepository {
  private readonly agents = new Map<string, AgentAggregate>();

  constructor(private readonly store: A2ACollaborationSnapshotStore) {}

  findById(id: AgentId): AgentAggregate | undefined { return this.agents.get(id.value); }

  save(agent: AgentAggregate): void {
    this.agents.set(agent.id.value, agent);
    const state = agent.snapshot();
    this.store.updateSnapshot((snapshot) => {
      const index = snapshot.agents.findIndex((entry) => entry.agentId === agent.id.value);
      if (index < 0) return snapshot;
      const current = snapshot.agents[index];
      if (!current) return snapshot;
      const projected = {
        ...current,
        state: state.state,
        capabilities: [...state.capabilities],
        lastActivityAt: state.lastActivityAt,
        ...(state.role !== undefined ? { role: state.role } : {}),
        ...(state.currentTaskId ? { currentTaskId: state.currentTaskId.value } : {}),
        ...(state.offlineReason ? { offlineReason: state.offlineReason } : {}),
      };
      if (state.role === undefined) delete projected.role;
      if (!state.currentTaskId) delete projected.currentTaskId;
      if (!state.offlineReason) delete projected.offlineReason;
      if (JSON.stringify(current) === JSON.stringify(projected)) return snapshot;
      const agents = [...snapshot.agents];
      agents[index] = projected;
      return { ...snapshot, agents };
    });
  }
}

/** Infrastructure Repository for Room roots stored in the existing runtime snapshot. */
export class SnapshotRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomAggregate>();

  constructor(private readonly store: A2ACollaborationSnapshotStore) {}

  findById(id: RoomId): RoomAggregate | undefined { return this.rooms.get(id.value); }

  save(room: RoomAggregate): void {
    this.rooms.set(room.id.value, room);
    const state = room.snapshot();
    this.store.updateSnapshot((snapshot) => {
      const index = snapshot.rooms.findIndex((entry) => entry.roomId === room.id.value);
      if (index < 0) return snapshot;
      const current = snapshot.rooms[index];
      if (!current) return snapshot;
      const projected = {
        ...current,
        name: state.name,
        agentIds: state.memberIds.map((agentId) => agentId.value),
        createdAt: state.createdAt,
      };
      if (JSON.stringify(current) === JSON.stringify(projected)) return snapshot;
      const rooms = [...snapshot.rooms];
      rooms[index] = projected;
      return { ...snapshot, rooms };
    });
  }
}
