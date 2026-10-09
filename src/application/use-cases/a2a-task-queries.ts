import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import { AgentId, TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { A2ATaskRecordDto } from "../dto/a2a-collaboration.js";
import { toA2ATaskRecordDto } from "../mappers/a2a-collaboration-mapper.js";

/** Provides read-only task records and the scheduling queries derived from them. */
export class A2ATaskQueries {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly assertInitialized: () => void,
    private readonly activeTaskCount: (agentId: string) => number,
  ) {}

  getTask(taskId: string): A2ATaskRecordDto | undefined {
    this.assertInitialized();
    if (typeof taskId !== "string" || taskId.length === 0) return undefined;
    const task = this.tasks.findById(new TaskId(taskId));
    return task ? toA2ATaskRecordDto(task.toRecord()) : undefined;
  }

  getTaskGraph(rootTaskId: string): A2ATaskRecordDto[] {
    this.assertInitialized();
    if (typeof rootTaskId !== "string" || rootTaskId.length === 0) return [];
    return [...this.tasks.findByRootId(new TaskId(rootTaskId))]
      .sort((left, right) => left.task.createdAt - right.task.createdAt || left.task.taskId.localeCompare(right.task.taskId))
      .map((task) => toA2ATaskRecordDto(task.toRecord()));
  }

  hasAcceptedResponseDelivery(taskId: string): boolean {
    if (typeof taskId !== "string" || taskId.length === 0) return false;
    return this.tasks.hasAcceptedResponseDelivery(new TaskId(taskId));
  }

  agentLoad(agentId: string): number {
    const queuedCount = typeof agentId === "string" && agentId.length > 0
      ? this.tasks.countQueuedForTargetAgent(new AgentId(agentId))
      : 0;
    return queuedCount + this.activeTaskCount(agentId);
  }
}
