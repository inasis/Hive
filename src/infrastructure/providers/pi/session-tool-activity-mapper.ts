import type { AssistantToolActivity } from "../../../application/ports/events.js";
import { asObject } from "./session-json-values.js";
import { messageText } from "./session-transcript.js";
import type { JsonObject } from "./session-types.js";

/** Maps Pi tool execution records to the provider-neutral activity contract. */
export function mapPiToolActivity(record: JsonObject, completed = false): AssistantToolActivity {
  const toolName = optionalString(record.toolName) ?? "Pi tool";
  const args = asObject(record.args) ?? {};
  const id = optionalString(record.toolCallId);
  const status = completed ? record.isError === true ? "failed" : "completed" : "running";
  if (["write", "edit"].includes(toolName)) {
    const path = optionalString(args.path) ?? optionalString(args.filePath);
    return { kind: "fileChange", ...(id ? { id } : {}), paths: path ? [path] : [], status };
  }
  if (toolName === "bash" || toolName === "powershell" || toolName === "read") {
    const command = optionalString(args.command) ?? optionalString(args.script);
    const result = asObject(record.result);
    const output = messageText(result?.content) || optionalString(result?.output);
    const displayCommand = command ?? (toolName === "read" ? `read ${optionalString(args.path) ?? ""}` : undefined);
    return { kind: "commandExecution", ...(id ? { id } : {}), ...(displayCommand ? { command: displayCommand } : {}), ...(output ? { output } : {}), status };
  }
  const result = asObject(record.result);
  const output = messageText(result?.content) || optionalString(result?.output);
  return {
    kind: "commandExecution",
    ...(id ? { id } : {}),
    command: `${toolName} ${JSON.stringify(args)}`,
    ...(output ? { output } : {}),
    status,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
