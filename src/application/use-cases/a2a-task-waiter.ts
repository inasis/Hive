import { getRemainingTaskTimeoutMs, type AgentTaskRecord } from "../../domain/collaboration/aggregates/task.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import { TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { A2ARuntimeEvent, A2ATaskWaitResult, A2AWorkspaceLockPort } from "../ports/a2a-runtime.js";
import { isTerminalTask } from "../validation/a2a-runtime-copy.js";
import { raceWithAbort } from "../validation/a2a-abort-race.js";
import { requireNonEmpty } from "../validation/a2a-runtime-validation.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import type { A2AAgentActivity } from "./a2a-agent-activity.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import type { TimerHandle, TimerPort } from "../ports/timers.js";

type WorkspaceLockState = { release: (() => void) | undefined };

type A2ATaskWaiterDependencies = {
  tasks: TaskRepository;
  directory: Pick<A2ARuntimeDirectoryPort, "getAgentNode">;
  activity: A2AAgentActivity;
  workspaceLocks: A2AWorkspaceLockPort;
  timers: TimerPort;
  workspaceLockReleases: Map<string, WorkspaceLockState>;
  abortControllers: Map<string, AbortController>;
  subscribe(handler: (event: A2ARuntimeEvent) => void): () => void;
  transitionTask(record: TaskAggregate, next: "RUNNING" | "WAITING"): void;
  readClock(): number;
  persist(): Promise<void>;
  assertInitialized(): void;
};

/** Waits for child task completion while suspending and resuming its active parent. */
export class A2ATaskWaiter {
  private readonly activeTaskWaits = new Map<string, Set<string>>();

  constructor(private readonly dependencies: A2ATaskWaiterDependencies) {}

  async waitForTask(taskId: string, waitMs = 20_000): Promise<A2ATaskWaitResult> {
    this.dependencies.assertInitialized();
    requireNonEmpty(taskId, "taskId");
    if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 30_000) {
      throw runtimeFault("INVALID_REQUEST", "", "waitMs must be an integer from 1 to 30000");
    }
    const { tasks, directory } = this.dependencies;
    let record = tasks.findById(new TaskId(taskId));
    if (!record) throw runtimeFault("INVALID_REQUEST", "", "Task does not exist");
    if (isTerminalTask(record.state)) return toTaskWaitResult(record);

    const parentTaskId = record.task.parentTaskId;
    const parent = parentTaskId ? tasks.findById(new TaskId(parentTaskId)) : undefined;
    if (parent && (parent.state === "RUNNING" || parent.state === "WAITING")) {
      const waiters = this.activeTaskWaits.get(parentTaskId!) ?? new Set<string>();
      waiters.add(taskId);
      this.activeTaskWaits.set(parentTaskId!, waiters);
      if (waiters.size === 1 && parent.state === "RUNNING") {
        this.dependencies.activity.addWaiting(parent.task.targetAgent, parent.task.taskId);
        this.dependencies.transitionTask(parent, "WAITING");
        const workspaceLock = this.dependencies.workspaceLockReleases.get(parent.task.taskId);
        workspaceLock?.release?.();
        if (workspaceLock) workspaceLock.release = undefined;
        const parentAgent = directory.getAgentNode(parent.task.targetAgent);
        if (parentAgent) this.dependencies.activity.refreshAgentState(parentAgent);
        await this.dependencies.persist();
      }
    }
    try {
      await new Promise<void>((resolve) => {
        let settled = false;
        let timer: TimerHandle | undefined;
        let unsubscribe = (): void => undefined;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          if (timer) this.dependencies.timers.cancel(timer);
          unsubscribe();
          resolve();
        };
        unsubscribe = this.dependencies.subscribe((event) => {
          if (event.type !== "task.updated" || event.task.task.taskId !== taskId || !isTerminalTask(event.task.state)) return;
          finish();
        });
        timer = this.dependencies.timers.schedule(finish, waitMs);
        record = tasks.findById(new TaskId(taskId));
        if (record && isTerminalTask(record.state)) finish();
      });
    } finally {
      if (parentTaskId) {
        const waiters = this.activeTaskWaits.get(parentTaskId);
        waiters?.delete(taskId);
        if (waiters?.size === 0) {
          this.activeTaskWaits.delete(parentTaskId);
          const currentParent = tasks.findById(new TaskId(parentTaskId));
          const parentAgent = currentParent ? directory.getAgentNode(currentParent.task.targetAgent) : undefined;
          const parentController = this.dependencies.abortControllers.get(parentTaskId);
          if (currentParent?.state === "WAITING" && parentAgent?.workspace && parentController && !parentController.signal.aborted) {
            const remaining = getRemainingTaskTimeoutMs(currentParent.task, this.dependencies.readClock());
            if (remaining === undefined || remaining > 0) {
              try {
                const release = await raceWithAbort(
                  this.dependencies.workspaceLocks.acquire(parentAgent.workspace, parentController.signal),
                  parentController.signal,
                  () => false,
                );
                const workspaceLock = this.dependencies.workspaceLockReleases.get(parentTaskId);
                if (workspaceLock) workspaceLock.release = release;
                else this.dependencies.workspaceLockReleases.set(parentTaskId, { release });
              } catch {
                // Parent cancellation or timeout takes precedence over reacquiring its workspace.
              }
            }
          }
          if (currentParent && currentParent.state === "WAITING") {
            this.dependencies.activity.removeWaiting(currentParent.task.targetAgent, currentParent.task.taskId);
            if (!parentController?.signal.aborted && (!parentAgent?.workspace || this.dependencies.workspaceLockReleases.get(parentTaskId)?.release)) {
              this.dependencies.transitionTask(currentParent, "RUNNING");
              if (parentAgent) this.dependencies.activity.refreshAgentState(parentAgent);
            }
            await this.dependencies.persist();
          }
        }
      }
    }
    record = tasks.findById(new TaskId(taskId));
    if (!record) throw runtimeFault("INVALID_REQUEST", "", "Task does not exist");
    return toTaskWaitResult(record);
  }
}

function toTaskWaitResult(record: TaskAggregate): A2ATaskWaitResult {
  return {
    completed: isTerminalTask(record.state),
    taskId: record.task.taskId,
    state: record.state,
    ...(record.result ? { result: record.result } : {}),
    ...(record.error ? { error: { ...record.error } } : {}),
  };
}
