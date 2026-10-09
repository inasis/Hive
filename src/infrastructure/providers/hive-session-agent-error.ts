import type { A2ATaskDto as AgentTask, A2ATaskResultDto as AgentResult } from "../../application/dto/a2a-collaboration.js";

export function hiveSessionProviderFault(code: string, message: string): Error & { code: string; provider: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, provider: "", retryable: code === "PROVIDER_UNAVAILABLE" });
}

export function hiveSessionCancelledResult(task: AgentTask): AgentResult {
  return { taskId: task.taskId, agentId: task.targetAgent, status: "CANCELLED", message: "Task was cancelled." };
}

export function hiveSessionFailedResult(task: AgentTask, code: string, message: string): AgentResult {
  return {
    taskId: task.taskId,
    agentId: task.targetAgent,
    status: "FAILED",
    message,
    metadata: { adapterErrorCode: code },
  };
}
