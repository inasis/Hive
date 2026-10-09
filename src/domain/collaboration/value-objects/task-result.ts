import type { AgentResult } from "../aggregates/task.js";
import { copyTaskMetadata, taskDataEquals } from "./copy-task-data.js";

export class TaskResult {
  private constructor(private readonly value: AgentResult) {}

  get status(): AgentResult["status"] { return this.value.status; }

  equals(other: TaskResult): boolean {
    return taskDataEquals(this.value, other.value);
  }

  static from(value: AgentResult): TaskResult {
    if (!value.taskId || !value.agentId || typeof value.message !== "string" ||
        (value.status !== "COMPLETED" && value.status !== "FAILED" && value.status !== "CANCELLED" && value.status !== "TIMED_OUT")) {
      throw new Error("Task result is invalid");
    }
    return new TaskResult(copyResult(value));
  }

  matches(taskId: string, agentId: string): boolean {
    return this.value.taskId === taskId && this.value.agentId === agentId;
  }

  toObject(): AgentResult {
    return copyResult(this.value);
  }
}

function copyResult(result: AgentResult): AgentResult {
  return {
    ...result,
    ...(result.artifacts ? { artifacts: result.artifacts.map((artifact) => ({ ...artifact })) } : {}),
    ...(result.metadata ? { metadata: copyTaskMetadata(result.metadata) } : {}),
  };
}
