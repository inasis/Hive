import { isTaskError, isTaskMessageType, isTaskState } from "./task.js";
import type { AgentTask, AgentTaskRecord, AgentResult, TaskError, TaskState } from "./task.js";
import { AgentId, FlowId, RoomId, TaskId } from "../value-objects/identifiers.js";
import { AgentPath, FlowDepth, TaskDepth } from "../value-objects/task-lineage.js";
import { TaskDelivery } from "../value-objects/task-delivery.js";
import { TaskResult } from "../value-objects/task-result.js";
import { copyTaskMetadata } from "../value-objects/copy-task-data.js";

type TaskDetails = Omit<AgentTask, "taskId" | "rootTaskId" | "parentTaskId" | "roomId" | "sourceAgent" | "targetAgent" | "depth" | "maxDepth" | "visitedAgents">;

/** Task aggregate root. Runtime events and persistence receive plain record snapshots. */
export class TaskAggregate {
  readonly id: TaskId;
  readonly roomId: RoomId;
  readonly sourceAgentId: AgentId | undefined;
  readonly targetAgentId: AgentId;
  readonly depth: TaskDepth;
  readonly maxDepth: TaskDepth;
  private taskAgentPath: AgentPath;
  private readonly sourceAgent: string;
  readonly delivery: TaskDelivery | undefined;
  readonly flowId: FlowId | undefined;
  readonly flowDepth: FlowDepth | undefined;
  readonly callbackForTaskId: TaskId | undefined;
  readonly responseForTaskId: TaskId | undefined;

  private readonly rootTaskId: TaskId;
  private readonly parentTaskId: TaskId | undefined;
  private readonly taskDetails: TaskDetails;
  private taskState: TaskState;
  private lastUpdatedAt: number;
  private taskResult: TaskResult | undefined;
  private taskError: TaskError | undefined;
  private callbackSubmitted = false;
  private callbackReserved = false;

  private constructor(record: AgentTaskRecord) {
    const task = record.task;
    if (!isTaskMessageType(task.type)) throw new Error("Task message type is invalid");
    if (typeof task.message !== "string") throw new Error("Task message must be a string");
    if (!Number.isSafeInteger(task.timeoutMs) || task.timeoutMs < 0) {
      throw new Error("Task timeout must be a non-negative safe integer");
    }
    if (!Number.isFinite(task.createdAt)) throw new Error("Task creation timestamp must be finite");
    if (!isTaskState(record.state)) throw new Error("Task state is invalid");

    this.id = new TaskId(task.taskId);
    this.rootTaskId = new TaskId(task.rootTaskId);
    this.parentTaskId = task.parentTaskId === undefined ? undefined : new TaskId(task.parentTaskId);
    this.roomId = new RoomId(task.roomId);
    this.sourceAgent = task.sourceAgent;
    this.sourceAgentId = task.sourceAgent && task.sourceAgent !== "orchestrator"
      ? new AgentId(task.sourceAgent)
      : undefined;
    this.targetAgentId = new AgentId(task.targetAgent);
    this.depth = new TaskDepth(task.depth);
    this.maxDepth = new TaskDepth(task.maxDepth);
    if (this.maxDepth.value < this.depth.value) throw new Error("Task maxDepth must be at least its depth");
    if (this.parentTaskId === undefined) {
      if (this.depth.value !== 0 || !this.rootTaskId.equals(this.id)) {
        throw new Error("Root task identity and depth are inconsistent");
      }
    } else if (this.depth.value === 0 || this.parentTaskId.equals(this.id) || this.rootTaskId.equals(this.id)) {
      throw new Error("Child task identity and depth are inconsistent");
    }
    this.taskAgentPath = new AgentPath(task.visitedAgents);
    const legacyNativeRoot = !task.parentTaskId && task.depth === 0 && task.sourceAgent !== "orchestrator" &&
      task.visitedAgents.length === 2 && task.visitedAgents[0] === task.sourceAgent && task.visitedAgents[1] === task.targetAgent;
    if ((this.taskAgentPath.length !== this.depth.value + 1 && !legacyNativeRoot) ||
        this.taskAgentPath.last()?.value !== this.targetAgentId.value) {
      throw new Error("Task agent path does not match its target and depth");
    }
    this.taskDetails = copyTaskDetails(task);
    this.delivery = TaskDelivery.from(task.metadata?.delivery);
    this.callbackForTaskId = optionalTaskId(task.metadata, "callbackForTaskId");
    this.responseForTaskId = optionalTaskId(task.metadata, "responseForTaskId");
    if (this.callbackForTaskId && this.responseForTaskId) {
      throw new Error("Task cannot be both a callback and a response delivery");
    }
    if ((this.callbackForTaskId && this.delivery?.value !== "a2a-result-callback") ||
        (this.delivery?.value === "a2a-result-callback" && !this.callbackForTaskId)) {
      throw new Error("Task callback reference does not match its delivery");
    }
    if ((this.responseForTaskId && this.delivery?.value !== "a2a-result-delivery") ||
        (this.delivery?.value === "a2a-result-delivery" && !this.responseForTaskId) ||
        (this.responseForTaskId && this.parentTaskId?.value !== this.responseForTaskId.value)) {
      throw new Error("Task response reference does not match its delivery or parent");
    }
    if (this.callbackForTaskId && this.parentTaskId) {
      throw new Error("Callback tasks must be independent root tasks");
    }
    const flowId = task.metadata?.a2aFlowId;
    if (flowId !== undefined && (typeof flowId !== "string" || flowId.trim().length === 0)) {
      throw new Error("Task flow ID must be a non-empty string");
    }
    this.flowId = typeof flowId === "string" ? new FlowId(flowId) : undefined;
    const flowDepth = task.metadata?.a2aFlowDepth;
    if (flowDepth !== undefined && (typeof flowDepth !== "number" || !Number.isSafeInteger(flowDepth) || flowDepth < 0)) {
      throw new Error("Task flow depth must be a non-negative safe integer");
    }
    this.flowDepth = typeof flowDepth === "number" ? new FlowDepth(flowDepth) : undefined;
    if (this.flowDepth && this.flowDepth.value > this.maxDepth.value) {
      throw new Error("Task flow depth must not exceed maxDepth");
    }
    if (!Number.isFinite(record.updatedAt)) throw new Error("Task update timestamp must be finite");
    this.taskState = record.state;
    this.lastUpdatedAt = record.updatedAt;
    this.taskResult = record.result === undefined ? undefined : TaskResult.from(record.result);
    if (this.taskResult && !this.taskResult.matches(this.id.value, this.targetAgentId.value)) {
      throw new Error("Task result identity does not match its aggregate");
    }
    if ((this.taskResult && !resultMatchesState(this.taskState, this.taskResult.status)) ||
        (this.taskState === "COMPLETED" && !this.taskResult)) {
      throw new Error("Task result status does not match its aggregate state");
    }
    if (record.error !== undefined && !isTaskError(record.error)) throw new Error("Task error is invalid");
    this.taskError = record.error === undefined ? undefined : { ...record.error };
  }

  static create(task: AgentTask, state: TaskState = "QUEUED", updatedAt = task.createdAt): TaskAggregate {
    return new TaskAggregate({ task, state, updatedAt });
  }

  static reconstitute(record: AgentTaskRecord): TaskAggregate {
    return new TaskAggregate(record);
  }

  get task(): AgentTask {
    return {
      ...this.taskDetails,
      ...(this.taskDetails.metadata ? { metadata: copyTaskMetadata(this.taskDetails.metadata) } : {}),
      taskId: this.id.value,
      rootTaskId: this.rootTaskId.value,
      ...(this.parentTaskId ? { parentTaskId: this.parentTaskId.value } : {}),
      roomId: this.roomId.value,
      sourceAgent: this.sourceAgent,
      targetAgent: this.targetAgentId.value,
      depth: this.depth.value,
      maxDepth: this.maxDepth.value,
      visitedAgents: this.taskAgentPath.agentIds,
    };
  }

  get state(): TaskState { return this.taskState; }
  get updatedAt(): number { return this.lastUpdatedAt; }
  get result(): AgentResult | undefined { return this.taskResult?.toObject(); }
  get error(): TaskError | undefined { return this.taskError ? { ...this.taskError } : undefined; }
  get agentPath(): AgentPath { return this.taskAgentPath; }
  get rootId(): TaskId { return this.rootTaskId; }
  get parentId(): TaskId | undefined { return this.parentTaskId; }
  get hasCallbackSubmission(): boolean { return this.callbackSubmitted || this.callbackReserved; }

  canCreateChildInRoom(roomId: RoomId): boolean {
    return this.roomId.equals(roomId);
  }

  reserveCallbackSubmission(): boolean {
    if (this.hasCallbackSubmission) return false;
    this.callbackReserved = true;
    return true;
  }

  commitCallbackSubmission(): void {
    if (this.callbackSubmitted) return;
    if (!this.callbackReserved) throw new Error("Task callback submission was not reserved");
    this.callbackReserved = false;
    this.callbackSubmitted = true;
  }

  releaseCallbackSubmission(): void {
    this.callbackReserved = false;
  }

  restoreCallbackSubmission(): void {
    this.callbackReserved = false;
    this.callbackSubmitted = true;
  }

  transition(next: TaskState, updatedAt: number): void {
    if (!canTransitionTask(this.taskState, next)) {
      throw new Error(`Invalid task state transition: ${this.taskState} -> ${next}`);
    }
    if (!Number.isFinite(updatedAt)) throw new Error("Task update timestamp must be finite");
    if ((this.taskResult && !resultMatchesState(next, this.taskResult.status)) ||
        (next === "COMPLETED" && !this.taskResult)) {
      throw new Error("Task result status does not match the requested state");
    }
    this.taskState = next;
    this.lastUpdatedAt = updatedAt;
  }

  finishWithResult(result: AgentResult, updatedAt: number): void {
    const value = TaskResult.from(result);
    if (!value.matches(this.id.value, this.targetAgentId.value)) {
      throw new Error("Task result identity does not match its aggregate");
    }
    if (!canTransitionTask(this.taskState, value.status)) {
      throw new Error(`Invalid task state transition: ${this.taskState} -> ${value.status}`);
    }
    if (!Number.isFinite(updatedAt)) throw new Error("Task update timestamp must be finite");
    this.taskResult = value;
    this.taskState = value.status;
    this.lastUpdatedAt = updatedAt;
  }

  setError(error: TaskError): void {
    if (!isTaskError(error)) throw new Error("Task error is invalid");
    this.taskError = { ...error };
  }

  touch(updatedAt: number): void {
    if (!Number.isFinite(updatedAt)) throw new Error("Task update timestamp must be finite");
    this.lastUpdatedAt = updatedAt;
  }

  normalizeLegacyNativeRootPath(): boolean {
    if (this.parentTaskId !== undefined || this.depth.value !== 0 || this.sourceAgent === "orchestrator") return false;
    const path = this.taskAgentPath.agentIds;
    if (path.length === 2 && path[0] === this.sourceAgent && path[1] === this.targetAgentId.value) {
      this.taskAgentPath = new AgentPath([this.targetAgentId.value]);
      return true;
    }
    return false;
  }

  toRecord(): AgentTaskRecord {
    return {
      task: this.task,
      state: this.taskState,
      updatedAt: this.lastUpdatedAt,
      ...(this.taskResult ? { result: this.taskResult.toObject() } : {}),
      ...(this.taskError ? { error: { ...this.taskError } } : {}),
    };
  }
}

function canTransitionTask(from: TaskState, to: TaskState): boolean {
  if (from === to) return true;
  if (from === "QUEUED") return to === "RUNNING" || to === "FAILED" || to === "CANCELLED" || to === "TIMED_OUT";
  if (from === "RUNNING") return to === "WAITING" || to === "COMPLETED" || to === "FAILED" || to === "CANCELLED" || to === "TIMED_OUT";
  if (from === "WAITING") return to === "RUNNING" || to === "FAILED" || to === "CANCELLED" || to === "TIMED_OUT";
  return false;
}

function resultMatchesState(state: TaskState, resultStatus: AgentResult["status"]): boolean {
  return state === resultStatus;
}

function copyTaskDetails(task: AgentTask): TaskDetails {
  return {
    type: task.type,
    message: task.message,
    timeoutMs: task.timeoutMs,
    createdAt: task.createdAt,
    ...(task.metadata ? { metadata: copyTaskMetadata(task.metadata) } : {}),
  };
}

function optionalTaskId(metadata: Record<string, unknown> | undefined, field: string): TaskId | undefined {
  const value = metadata?.[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Task ${field} must be a non-empty string`);
  }
  return new TaskId(value);
}
