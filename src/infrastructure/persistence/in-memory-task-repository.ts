import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import type { AgentId, TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { A2ATaskRecordDto } from "../../application/dto/a2a-collaboration.js";
import type { A2ATaskSnapshotSource } from "../../application/ports/a2a-task-snapshot-source.js";
import { toA2ATaskRecordDto } from "../../application/mappers/a2a-collaboration-mapper.js";

/** Process-local Task repository; durable restart recovery remains owned by the runtime snapshot store. */
export class InMemoryTaskRepository implements TaskRepository, A2ATaskSnapshotSource {
  private readonly tasks = new Map<string, TaskAggregate>();

  findById(id: TaskId): TaskAggregate | undefined {
    return this.tasks.get(id.value);
  }

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
  }
}
