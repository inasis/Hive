import { AgentId, TaskId } from "../value-objects/identifiers.js";
import type { AgentTask } from "./task.js";
import { TaskAggregate } from "./task-aggregate.js";

export type AgentState = "IDLE" | "WORKING" | "WAITING" | "ERROR" | "OFFLINE";
export type AgentOfflineReason = "SESSION_UNAVAILABLE" | "ADAPTER_UNAVAILABLE" | "PROCESS_TERMINATED";

export function isAgentState(value: unknown): value is AgentState {
  return value === "IDLE" || value === "WORKING" || value === "WAITING" || value === "ERROR" || value === "OFFLINE";
}

export function isAgentOfflineReason(value: unknown): value is AgentOfflineReason {
  return value === "SESSION_UNAVAILABLE" || value === "ADAPTER_UNAVAILABLE" || value === "PROCESS_TERMINATED";
}

/** Domain state kept by the Agent aggregate; provider and native-session details live in Application DTOs. */
export type AgentStateSnapshot = {
  id: AgentId;
  state: AgentState;
  role?: string;
  capabilities: readonly string[];
  currentTaskId?: TaskId;
  lastActivityAt: number;
  offlineReason?: AgentOfflineReason;
};

/** Agent aggregate root for collaboration identity, profile, and availability. */
export class AgentAggregate {
  readonly id: AgentId;
  private currentState: AgentState;
  private currentRole: string | undefined;
  private currentCapabilities: string[];
  private activeTaskId: TaskId | undefined;
  private activityTimestamp: number;
  private unavailableReason: AgentOfflineReason | undefined;

  private constructor(snapshot: AgentStateSnapshot) {
    if (!isAgentState(snapshot.state)) throw new Error("Agent state is invalid");
    if (snapshot.offlineReason !== undefined && !isAgentOfflineReason(snapshot.offlineReason)) {
      throw new Error("Agent offline reason is invalid");
    }
    if (!Array.isArray(snapshot.capabilities) || snapshot.capabilities.some((value) => typeof value !== "string")) {
      throw new Error("Agent capabilities must be strings");
    }
    if (!Number.isFinite(snapshot.lastActivityAt)) throw new Error("Agent activity timestamp must be finite");
    this.id = snapshot.id;
    this.currentState = snapshot.state;
    this.currentRole = snapshot.role;
    this.currentCapabilities = uniqueCapabilities(snapshot.capabilities);
    this.activeTaskId = snapshot.currentTaskId;
    this.activityTimestamp = snapshot.lastActivityAt;
    this.unavailableReason = snapshot.offlineReason;
    if (this.currentState === "OFFLINE" && !this.unavailableReason) {
      this.unavailableReason = "SESSION_UNAVAILABLE";
    }
    if (this.currentState !== "OFFLINE") this.unavailableReason = undefined;
  }

  static create(snapshot: AgentStateSnapshot): AgentAggregate {
    return new AgentAggregate(snapshot);
  }

  static reconstitute(snapshot: AgentStateSnapshot): AgentAggregate {
    return new AgentAggregate(snapshot);
  }

  get state(): AgentState { return this.currentState; }
  get role(): string | undefined { return this.currentRole; }
  get capabilities(): readonly string[] { return [...this.currentCapabilities]; }
  get currentTaskId(): TaskId | undefined { return this.activeTaskId; }
  get lastActivityAt(): number { return this.activityTimestamp; }
  get offlineReason(): AgentOfflineReason | undefined { return this.unavailableReason; }

  transition(next: AgentState, timestamp: number, offlineReason?: AgentOfflineReason): void {
    if (!isAgentState(next)) throw new Error("Agent state is invalid");
    if (offlineReason !== undefined && !isAgentOfflineReason(offlineReason)) {
      throw new Error("Agent offline reason is invalid");
    }
    if (!canTransitionAgent(this.currentState, next)) {
      throw new Error(`Invalid agent state transition: ${this.currentState} -> ${next}`);
    }
    if (!Number.isFinite(timestamp)) throw new Error("Agent activity timestamp must be finite");
    this.currentState = next;
    this.unavailableReason = next === "OFFLINE" ? offlineReason ?? "SESSION_UNAVAILABLE" : undefined;
    this.activityTimestamp = timestamp;
  }

  touch(timestamp: number): void {
    if (!Number.isFinite(timestamp)) throw new Error("Agent activity timestamp must be finite");
    this.activityTimestamp = timestamp;
  }

  updateProfile(input: { role?: string | null; capabilities?: readonly string[] }, timestamp: number): void {
    if (input.role !== undefined) this.currentRole = input.role === null ? undefined : input.role;
    if (input.capabilities !== undefined) this.currentCapabilities = uniqueCapabilities(input.capabilities);
    this.touch(timestamp);
  }

  setCurrentTaskId(taskId: TaskId | undefined): void {
    this.activeTaskId = taskId;
  }

  canAcceptTask(input: { concurrentExecutionSupported: boolean; queueingAllowed: boolean }): boolean {
    if (this.currentState === "IDLE") return true;
    if (this.currentState === "WORKING" || this.currentState === "WAITING") {
      return input.concurrentExecutionSupported || input.queueingAllowed;
    }
    return false;
  }

  createTask(
    task: AgentTask,
    input: { concurrentExecutionSupported: boolean; queueingAllowed: boolean },
  ): TaskAggregate | undefined {
    if (task.targetAgent !== this.id.value) throw new Error("Agent can only create a task assigned to itself");
    if (!this.canAcceptTask(input)) return undefined;
    return TaskAggregate.create(task, "QUEUED", task.createdAt);
  }

  markUnavailable(reason: AgentOfflineReason): void {
    if (!isAgentOfflineReason(reason)) throw new Error("Agent offline reason is invalid");
    this.currentState = "OFFLINE";
    this.unavailableReason = reason;
    this.activeTaskId = undefined;
  }

  snapshot(): AgentStateSnapshot {
    return {
      id: this.id,
      state: this.currentState,
      ...(this.currentRole !== undefined ? { role: this.currentRole } : {}),
      capabilities: [...this.currentCapabilities],
      ...(this.activeTaskId ? { currentTaskId: this.activeTaskId } : {}),
      lastActivityAt: this.activityTimestamp,
      ...(this.unavailableReason ? { offlineReason: this.unavailableReason } : {}),
    };
  }
}

export function canTransitionAgent(from: AgentState, to: AgentState): boolean {
  if (from === to) return true;
  if (from === "IDLE") return to === "WORKING" || to === "OFFLINE" || to === "ERROR";
  if (from === "WORKING") return to === "IDLE" || to === "WAITING" || to === "OFFLINE" || to === "ERROR";
  if (from === "WAITING") return to === "WORKING" || to === "IDLE" || to === "OFFLINE" || to === "ERROR";
  if (from === "ERROR") return to === "IDLE" || to === "OFFLINE";
  return to === "IDLE" || to === "ERROR";
}

function uniqueCapabilities(capabilities: readonly string[]): string[] {
  return [...new Set(capabilities.filter((value) => value.trim().length > 0))];
}
