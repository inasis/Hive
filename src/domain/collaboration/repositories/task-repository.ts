import type { TaskAggregate } from "../aggregates/task-aggregate.js";
import type { AgentId, TaskId } from "../value-objects/identifiers.js";

/** Loads and stores Task roots and exposes explicit collaboration queries. */
export interface TaskRepository {
  findById(id: TaskId): TaskAggregate | undefined;
  findByRootId(rootTaskId: TaskId): readonly TaskAggregate[];
  hasAcceptedResponseDelivery(taskId: TaskId): boolean;
  hasCallbackForTask(taskId: TaskId): boolean;
  countQueuedForTargetAgent(agentId: AgentId): number;
  save(task: TaskAggregate): void;
}
