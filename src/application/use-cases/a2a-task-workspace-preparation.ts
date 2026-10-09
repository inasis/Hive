import type { AgentNode } from "../../application/dto/a2a-collaboration.js";
import { getRemainingTaskTimeoutMs, type AgentTaskRecord, type TaskState } from "../../domain/collaboration/aggregates/task.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { A2AWorkspaceLockPort } from "../ports/a2a-runtime.js";
import type { TimerPort } from "../ports/timers.js";
import { isTerminalTask } from "../validation/a2a-runtime-copy.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import { A2ATaskWorkspaceLock } from "./a2a-task-workspace-lock.js";

export type A2AWorkspaceLockState = { release: (() => void) | undefined };

export type A2ATaskWorkspacePreparationResult =
  | { kind: "completed" }
  | {
      kind: "ready";
      timedOut: boolean;
      adapterTimeoutMs: number | undefined;
      workspaceLock: A2AWorkspaceLockState;
    };

type A2ATaskWorkspacePreparationServices = {
  workspaceLocks: A2AWorkspaceLockPort;
  timers: TimerPort;
  readClock(): number;
  transitionTask(record: TaskAggregate, next: TaskState): void;
  persist(): Promise<void>;
  clearAbortController(taskId: string): void;
  setWorkspaceLock(taskId: string, state: A2AWorkspaceLockState): void;
  clearWorkspaceLock(taskId: string): void;
};

/** Acquires the task workspace and resolves deadline or cancellation while waiting. */
export class A2ATaskWorkspacePreparation {
  private readonly workspaceLock: A2ATaskWorkspaceLock;

  constructor(private readonly services: A2ATaskWorkspacePreparationServices) {
    this.workspaceLock = new A2ATaskWorkspaceLock(services.workspaceLocks, services.timers);
  }

  async prepare(
    record: TaskAggregate,
    agent: AgentNode,
    controller: AbortController,
    parentSignal?: AbortSignal,
  ): Promise<A2ATaskWorkspacePreparationResult> {
    let timedOut = false;
    let releaseWorkspaceLock: (() => void) | undefined;
    const workspaceLock: A2AWorkspaceLockState = { release: undefined };
    if (agent.workspace) {
      const lockTimeoutMs = getRemainingTaskTimeoutMs(record.task, this.services.readClock());
      if (lockTimeoutMs !== undefined && lockTimeoutMs <= 0) {
        this.services.clearAbortController(record.task.taskId);
        record.setError(runtimeFault("TIMEOUT", agent.provider, "Agent task expired while waiting for its workspace", true).detail);
        this.services.transitionTask(record, "TIMED_OUT");
        await this.services.persist();
        return { kind: "completed" };
      }
      const lockResult = await this.workspaceLock.wait(agent.workspace, controller.signal, lockTimeoutMs, () => {
        timedOut = true;
        controller.abort();
      });
      if (lockResult.kind !== "acquired") {
        this.services.clearAbortController(record.task.taskId);
        releaseWorkspaceLock?.();
        workspaceLock.release = undefined;
        this.services.clearWorkspaceLock(record.task.taskId);
        if (!isTerminalTask(record.state)) {
          if (lockResult.kind === "timed-out") {
            record.setError(runtimeFault("TIMEOUT", agent.provider, "Agent task timed out waiting for its workspace", true).detail);
            this.services.transitionTask(record, "TIMED_OUT");
          } else {
            this.services.transitionTask(record, "CANCELLED");
          }
        }
        await this.services.persist();
        return { kind: "completed" };
      }
      releaseWorkspaceLock = lockResult.release;
      workspaceLock.release = lockResult.release;
      this.services.setWorkspaceLock(record.task.taskId, workspaceLock);
      if (isTerminalTask(record.state) || controller.signal.aborted || parentSignal?.aborted) {
        releaseWorkspaceLock();
        workspaceLock.release = undefined;
        this.services.clearWorkspaceLock(record.task.taskId);
        this.services.clearAbortController(record.task.taskId);
        if (!isTerminalTask(record.state)) {
          if (timedOut) {
            record.setError(runtimeFault("TIMEOUT", agent.provider, "Agent task timed out waiting for its workspace", true).detail);
            this.services.transitionTask(record, "TIMED_OUT");
          } else {
            this.services.transitionTask(record, "CANCELLED");
          }
        }
        await this.services.persist();
        return { kind: "completed" };
      }
    }

    const adapterTimeoutMs = getRemainingTaskTimeoutMs(record.task, this.services.readClock());
    if (adapterTimeoutMs !== undefined && adapterTimeoutMs <= 0) {
      releaseWorkspaceLock?.();
      workspaceLock.release = undefined;
      this.services.clearWorkspaceLock(record.task.taskId);
      this.services.clearAbortController(record.task.taskId);
      record.setError(runtimeFault("TIMEOUT", agent.provider, "Agent task expired before execution", true).detail);
      this.services.transitionTask(record, "TIMED_OUT");
      await this.services.persist();
      return { kind: "completed" };
    }

    return { kind: "ready", timedOut, adapterTimeoutMs, workspaceLock };
  }
}
