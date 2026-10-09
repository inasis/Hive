import type { A2ATaskResultDto as AgentResult } from "../../application/dto/a2a-collaboration.js";
import type { TurnCompletion } from "./hive-session-turn-registry.js";

export type HiveSessionTurnResult = Pick<AgentResult, "status" | "message"> & {
  output: string;
};

/** Maps provider turn events and collected messages to the A2A task result. */
export function mapHiveSessionTurnCompletion(
  completion: TurnCompletion,
  messages: ReadonlyMap<string, string>,
): HiveSessionTurnResult {
  const output = [...messages.values()]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n");
  const status = normalizedTurnStatus(completion);

  return {
    output,
    status,
    message: output || completion.error || (status === "COMPLETED" ? "Task completed without a text response." : "Provider task failed."),
  };
}

function normalizedTurnStatus(completion: TurnCompletion): AgentResult["status"] {
  const status = completion.status?.toLowerCase() ?? "completed";
  if (status.includes("cancel") || status.includes("interrupt")) return "CANCELLED";
  if (status.includes("fail") || status.includes("error")) return "FAILED";
  return "COMPLETED";
}
