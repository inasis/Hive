import type { TaskAggregate } from "../aggregates/task-aggregate.js";

/** Pure rules for resolving A2A flow identity and depth across task ancestry. */
export class TaskFlowPolicy {
  static isA2AFlowTask(task: TaskAggregate | undefined): task is TaskAggregate {
    return task?.delivery?.isA2AFlow === true;
  }

  static resolveFlowId(task: TaskAggregate, relatedTasks: ReadonlyMap<string, TaskAggregate>): string {
    return this.resolveFlowIdFrom(task, relatedTasks, new Set());
  }

  static resolveFlowDepth(task: TaskAggregate, relatedTasks: ReadonlyMap<string, TaskAggregate>): number {
    return this.resolveFlowDepthFrom(task, relatedTasks, new Set());
  }

  private static resolveFlowIdFrom(
    task: TaskAggregate,
    relatedTasks: ReadonlyMap<string, TaskAggregate>,
    visited: Set<string>,
  ): string {
    if (task.flowId) return task.flowId.value;
    if (visited.has(task.id.value)) return task.rootId.value;
    visited.add(task.id.value);

    const relatedId = task.callbackForTaskId ?? task.parentId;
    const related = relatedId ? relatedTasks.get(relatedId.value) : undefined;
    if (this.isA2AFlowTask(related)) return this.resolveFlowIdFrom(related, relatedTasks, visited);

    if (!task.rootId.equals(task.id)) {
      const root = relatedTasks.get(task.rootId.value);
      if (this.isA2AFlowTask(root)) return this.resolveFlowIdFrom(root, relatedTasks, visited);
    }
    return task.rootId.value;
  }

  private static resolveFlowDepthFrom(
    task: TaskAggregate,
    relatedTasks: ReadonlyMap<string, TaskAggregate>,
    visited: Set<string>,
  ): number {
    if (task.flowDepth) return task.flowDepth.value;
    if (visited.has(task.id.value)) return task.depth.value;
    visited.add(task.id.value);

    const relatedId = task.callbackForTaskId ?? task.parentId;
    const related = relatedId ? relatedTasks.get(relatedId.value) : undefined;
    if (this.isA2AFlowTask(related)) return this.resolveFlowDepthFrom(related, relatedTasks, visited) + 1;
    return task.depth.value;
  }
}
