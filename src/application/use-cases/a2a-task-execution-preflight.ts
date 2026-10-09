import type { AdapterError } from "../../domain/a2a-adapter.js";
import type {
  A2AAgentPermissionProfileDto,
  A2ATaskRecordDto,
  AgentNode,
  NativeSession,
} from "../../application/dto/a2a-collaboration.js";
import {
  type AgentTaskRecord,
  type TaskState,
  getRemainingTaskTimeoutMs,
} from "../../domain/collaboration/aggregates/task.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type {
  A2ATaskDirectoryPort,
  A2APermissionSourceDirectoryPort,
  A2AWorkspaceLockPort,
} from "../ports/a2a-runtime.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { TimerPort } from "../ports/timers.js";
import { A2APermissionInheritance } from "./a2a-permission-inheritance.js";
import { A2ATaskAvailabilityCheck } from "./a2a-task-availability-check.js";
import { getTaskExecutionCompatibilityError } from "./a2a-task-execution-compatibility.js";
import {
  A2ATaskWorkspacePreparation,
  type A2AWorkspaceLockState,
} from "./a2a-task-workspace-preparation.js";
import { copyTaskRecord, isTerminalTask } from "../validation/a2a-runtime-copy.js";
import { normalizeAdapterError, runtimeFault } from "../validation/a2a-runtime-errors.js";

export type { A2AWorkspaceLockState } from "./a2a-task-workspace-preparation.js";

export type A2ATaskExecutionPreflightServices = {
  directory: A2ATaskDirectoryPort & A2APermissionSourceDirectoryPort;
  workspaceLocks: A2AWorkspaceLockPort;
  timers: TimerPort;
  now(): number;
  persist(): Promise<void>;
  transitionTask(record: TaskAggregate, next: TaskState): void;
  finishFailure(record: TaskAggregate, error: AdapterError): void;
  setAgentState(agent: AgentNode, next: AgentNode["state"], offlineReason?: AgentNode["offlineReason"]): void;
  getTask(taskId: string): A2ATaskRecordDto | undefined;
  setAbortController(taskId: string, controller: AbortController): void;
  clearAbortController(taskId: string): void;
  setWorkspaceLock(taskId: string, state: A2AWorkspaceLockState): void;
  clearWorkspaceLock(taskId: string): void;
};

export type A2ATaskExecutionPreparation =
  | { kind: "completed"; record: AgentTaskRecord }
  | {
      kind: "ready";
      session: NativeSession;
      controller: AbortController;
      timedOut: boolean;
      inheritedPermissions?: A2AAgentPermissionProfileDto;
      adapterTimeoutMs: number | undefined;
      workspaceLock: A2AWorkspaceLockState;
    };

/** Resolves prerequisites and acquires the workspace lock before a provider turn starts. */
export class A2ATaskExecutionPreflight {
  private readonly permissionInheritance: A2APermissionInheritance;
  private readonly availabilityCheck: A2ATaskAvailabilityCheck;
  private readonly workspacePreparation: A2ATaskWorkspacePreparation;

  constructor(private readonly services: A2ATaskExecutionPreflightServices) {
    this.permissionInheritance = new A2APermissionInheritance({
      directory: services.directory,
      getTask: (taskId) => services.getTask(taskId),
    });
    this.availabilityCheck = new A2ATaskAvailabilityCheck({
      timers: services.timers,
      persist: () => services.persist(),
      transitionTask: (record, next) => services.transitionTask(record, next),
      finishFailure: (record, error) => services.finishFailure(record, error),
      setAgentState: (agent, next, reason) => services.setAgentState(agent, next, reason),
      clearAbortController: (taskId) => services.clearAbortController(taskId),
    });
    this.workspacePreparation = new A2ATaskWorkspacePreparation({
      workspaceLocks: services.workspaceLocks,
      timers: services.timers,
      readClock: () => this.readClock(),
      transitionTask: (record, next) => services.transitionTask(record, next),
      persist: () => services.persist(),
      clearAbortController: (taskId) => services.clearAbortController(taskId),
      setWorkspaceLock: (taskId, state) => services.setWorkspaceLock(taskId, state),
      clearWorkspaceLock: (taskId) => services.clearWorkspaceLock(taskId),
    });
  }

  async prepare(
    record: TaskAggregate,
    agent: AgentNode,
    adapter: AgentAdapter,
    parentSignal?: AbortSignal,
  ): Promise<A2ATaskExecutionPreparation> {
    if (isTerminalTask(record.state)) return this.completed(record);
    const remainingTimeoutMs = getRemainingTaskTimeoutMs(record.task, this.readClock());
    if (remainingTimeoutMs !== undefined && remainingTimeoutMs <= 0) {
      record.setError(runtimeFault("TIMEOUT", agent.provider, "Agent task expired while queued", true).detail);
      this.services.transitionTask(record, "TIMED_OUT");
      await this.services.persist();
      return this.completed(record);
    }
    const session = this.services.directory.getSession(agent.agentId);
    if (!session) {
      this.services.finishFailure(record, runtimeFault("SESSION_NOT_FOUND", agent.provider, "Registered native session was not found").detail);
      await this.services.persist();
      return this.completed(record);
    }
    if (parentSignal?.aborted) {
      this.services.transitionTask(record, "CANCELLED");
      await this.services.persist();
      return this.completed(record);
    }

    const controller = new AbortController();
    this.services.setAbortController(record.task.taskId, controller);
    const availability = await this.availabilityCheck.check(
      record,
      agent,
      session,
      adapter,
      controller,
      remainingTimeoutMs,
    );
    if (availability.kind === "completed") return this.completed(record);

    let inheritedPermissions: A2AAgentPermissionProfileDto | undefined;
    try {
      inheritedPermissions = await this.permissionInheritance.resolveForTask(record, session, adapter);
    } catch (error) {
      this.services.clearAbortController(record.task.taskId);
      this.services.finishFailure(record, normalizeAdapterError(error, agent.provider));
      await this.services.persist();
      return this.completed(record);
    }
    const compatibilityError = getTaskExecutionCompatibilityError(session, adapter, agent.provider);
    if (compatibilityError) {
      this.services.clearAbortController(record.task.taskId);
      this.services.finishFailure(record, compatibilityError);
      await this.services.persist();
      return this.completed(record);
    }
    const adapterTimeoutMs = getRemainingTaskTimeoutMs(record.task, this.readClock());
    if (adapterTimeoutMs !== undefined && adapterTimeoutMs <= 0) {
      this.services.clearAbortController(record.task.taskId);
      record.setError(runtimeFault("TIMEOUT", agent.provider, "Agent task expired before execution", true).detail);
      this.services.transitionTask(record, "TIMED_OUT");
      await this.services.persist();
      return this.completed(record);
    }

    if (parentSignal?.aborted) {
      this.services.clearAbortController(record.task.taskId);
      this.services.transitionTask(record, "CANCELLED");
      await this.services.persist();
      return this.completed(record);
    }

    const workspace = await this.workspacePreparation.prepare(record, agent, controller, parentSignal);
    if (workspace.kind === "completed") return this.completed(record);

    return {
      kind: "ready",
      session,
      controller,
      timedOut: workspace.timedOut,
      ...(inheritedPermissions ? { inheritedPermissions } : {}),
      adapterTimeoutMs: workspace.adapterTimeoutMs,
      workspaceLock: workspace.workspaceLock,
    };
  }

  private completed(record: TaskAggregate): A2ATaskExecutionPreparation {
    return { kind: "completed", record: record.toRecord() };
  }

  private readClock(): number {
    const value = this.services.now();
    if (!Number.isFinite(value)) throw new Error("A2A clock returned an invalid timestamp");
    return value;
  }
}
