import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import { TaskFlowPolicy } from "../../domain/collaboration/policies/task-flow-policy.js";

/** Loads the referenced task facts required by the pure Domain flow policy. */
function loadRelatedTasks(task: TaskAggregate, tasks: TaskRepository): ReadonlyMap<string, TaskAggregate> {
  const relatedTasks = new Map<string, TaskAggregate>();
  const visited = new Set<string>([task.id.value]);
  const pending = [task];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const references = [
      current.callbackForTaskId,
      current.parentId,
      current.rootId.equals(current.id) ? undefined : current.rootId,
    ];
    for (const reference of references) {
      if (!reference || visited.has(reference.value)) continue;
      visited.add(reference.value);
      const related = tasks.findById(reference);
      if (!related) continue;
      relatedTasks.set(related.id.value, related);
      pending.push(related);
    }
  }
  return relatedTasks;
}

/** Identify tasks that participate in an A2A request or result flow. */
export function isA2AFlowTask(task: TaskAggregate | undefined): task is TaskAggregate {
  return TaskFlowPolicy.isA2AFlowTask(task);
}

/** Resolve the stable flow ID after Application loads the referenced task facts. */
export function resolveA2AFlowId(task: TaskAggregate, tasks: TaskRepository): string {
  if (task.flowId) return task.flowId.value;
  return TaskFlowPolicy.resolveFlowId(task, loadRelatedTasks(task, tasks));
}

/** Resolve flow depth after Application loads the referenced task facts. */
export function resolveA2AFlowDepth(task: TaskAggregate, tasks: TaskRepository): number {
  if (task.flowDepth) return task.flowDepth.value;
  return TaskFlowPolicy.resolveFlowDepth(task, loadRelatedTasks(task, tasks));
}
