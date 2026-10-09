import type { A2ATaskDto } from "../dto/a2a-collaboration.js";

export type A2ATaskPromptInput = {
  task: A2ATaskDto;
  message: string;
  canDelegate: boolean;
};

/** Builds the provider-independent instructions for executing a Hive task in an existing session. */
export function buildA2ATaskPrompt({ task, message, canDelegate }: A2ATaskPromptInput): string {
  const callerAgentId = typeof task.metadata?.callerAgentId === "string" && task.metadata.callerAgentId.trim()
    ? task.metadata.callerAgentId
    : task.targetAgent;
  const delivery = task.metadata?.delivery;
  const lines = [
    "Hive task. Use only this request; read workspace files if more context is needed.",
    canDelegate
      ? `Hive tools: for new work or forwarding, call a2a_list and copy a targetAgent. Split large work into independent requests. Send with a2a_send(targetAgent, message[, timeoutMs]); set timeoutMs=0 when the duration is unknown. Reply to this task's sender with a2a_reply(replyToTaskId=${task.taskId}, message[, timeoutMs]); set timeoutMs=0 for unknown duration. To forward a result, use a2a_send(targetAgent, message, replyToTaskId=${task.taskId}). Include callerAgentId=${callerAgentId}. Do not wait or poll.`
      : "A2A tools are unavailable; complete the task directly.",
  ];
  if (delivery === "a2a-async-request") {
    lines.push(`A2A request from ${task.sourceAgent}: answer with a2a_reply(replyToTaskId=${task.taskId}, message). Hive sends it to the sender.`);
  } else if (delivery === "a2a-result-callback" || delivery === "a2a-result-delivery") {
    lines.push(`A2A result from ${task.sourceAgent}: use a2a_reply(replyToTaskId=${task.taskId}, message) to reply to the sender, a2a_send(targetAgent, message, replyToTaskId=${task.taskId}) to forward it, or finish.`);
  } else if (delivery === "a2b-bonded-request") {
    lines.push(`Bonded A2B from ${task.sourceAgent}: answer directly; do not delegate. If the caller must resume, use a2a_reply(replyToTaskId=${task.taskId}, message).`);
  }
  lines.push("", "Request:", message);
  return lines.join("\n");
}
