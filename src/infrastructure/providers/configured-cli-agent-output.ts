import type { A2ATaskDto as AgentTask, A2ATaskResultDto as AgentResult } from "../../application/dto/a2a-collaboration.js";
import type { ConfiguredCliAgentProfile } from "./configured-cli-agent-profile.js";
import { adapterFault } from "./configured-cli-agent-errors.js";

type AgentDelegationRequest = {
  interaction?: "A2A" | "A2B";
  targetAgent?: string;
  targetSessionName?: string;
  selector?: { role?: string; capabilities?: string[]; workspace?: string; provider?: string };
  message: string;
  timeoutMs?: number;
  responseForTaskId?: string;
  callbackForTaskId?: string;
};

export function formatPrompt(
  task: AgentTask,
  message: string,
  delegationProfile?: ConfiguredCliAgentProfile,
): string {
  const delegationInstruction = delegationProfile?.delegation
    ? delegationProfile.outputFormat === "ndjson"
      ? `\n\nEmit a final NDJSON result event where ${delegationProfile.ndjsonResultEvent!.eventField} is ${JSON.stringify(delegationProfile.ndjsonResultEvent!.eventName)} and ${delegationProfile.ndjsonResultEvent!.textField} contains your message. Include an optional delegations array. Each item can include interaction, message, targetSessionName (preferred) and/or targetAgent ID, or a selector; use responseForTaskId or callbackForTaskId to mark a response delivery. Delegations run asynchronously; do not wait for them. Do not delegate when the task can be completed directly.`
      : "\n\nReturn one JSON object with a message field. To send a task or response, add a delegations array with interaction, message, targetSessionName (preferred) and/or targetAgent ID, or a selector; use responseForTaskId or callbackForTaskId to mark a response delivery. Delegations run asynchronously; do not wait for them. Do not delegate when the task can be completed directly."
    : "";
  const delivery = task.metadata?.delivery;
  const taskInstruction = delivery === "a2a-async-request"
    ? `A2A request: deliver your answer in an async delegation with responseForTaskId=${task.taskId} to any chosen existing/new agent, or use callbackForTaskId with a task ID from this A2A flow to reach that task's source agent. The flow may visit agents more than once. Accepted delivery is success; do not wait for the recipient. A local result without delivery is incomplete.`
    : delivery === "a2a-result-delivery"
      ? `A2A response recipient: continue this flow with responseForTaskId=${task.taskId} to any chosen existing/new agent, use callbackForTaskId with a task ID from this flow to reach that task's source agent, or finish. Agents may appear more than once in the flow. Do not wait for accepted sends.`
      : delivery === "a2a-result-callback"
        ? `A2A callback recipient: continue this flow with responseForTaskId=${task.taskId} to any chosen existing/new agent, use callbackForTaskId with a task ID from this flow to reach that task's source agent, or finish. Agents may appear more than once in the flow.`
        : delivery === "a2b-bonded-request"
          ? `Bonded A2B: answer directly as this agent; do not delegate. If the caller must resume, send it a2a_send with callbackForTaskId=${task.taskId}.`
          : undefined;
  return [
    "Handle one Hive A2A task. Use only this request as task context; read workspace files if more context is needed.",
    `Task ID: ${task.taskId}`,
    ...(delegationProfile?.delegation ? [`Current Hive callerAgentId: ${typeof task.metadata?.callerAgentId === "string" ? task.metadata.callerAgentId : task.targetAgent}. Include this exact value in every A2A tool call.`] : []),
    ...(taskInstruction ? [taskInstruction] : []),
    ...(delegationInstruction ? [delegationInstruction.trim()] : []),
    "",
    "Request:",
    message,
  ].join("\n");
}

export function mapCommandResult(
  profile: ConfiguredCliAgentProfile,
  stdout: string,
  task: AgentTask,
): { result: AgentResult; delegations: AgentDelegationRequest[] } {
  if (profile.outputFormat === "text") {
    return { result: { taskId: task.taskId, agentId: task.targetAgent, status: "COMPLETED", message: stdout.trim() }, delegations: [] };
  }
  let value: unknown;
  if (profile.outputFormat === "json") {
    try { value = JSON.parse(stdout); } catch {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent returned invalid JSON output");
    }
  } else {
    const eventConfig = profile.ndjsonResultEvent!;
    const records: unknown[] = [];
    for (const line of stdout.split(/\r?\n/).filter((item) => item.trim())) {
      try { records.push(JSON.parse(line)); } catch {
        throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent returned an invalid NDJSON line");
      }
    }
    const event = [...records].reverse().find((item) => isRecord(item) && item[eventConfig.eventField] === eventConfig.eventName);
    const text = event && isRecord(event) ? readPath(event, eventConfig.textField) : undefined;
    if (typeof text !== "string") throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent NDJSON result event did not contain the configured text field");
    value = {
      message: text,
      ...(event && isRecord(event) ? { artifacts: event.artifacts, delegations: event.delegations ?? event.delegate } : {}),
    };
  }
  if (!isRecord(value) || typeof (value.message ?? value.text) !== "string") {
    throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent JSON output must contain a message or text field");
  }
  const artifacts = value.artifacts;
  if (artifacts !== undefined && (!Array.isArray(artifacts) || artifacts.some((item) => !isRecord(item) || typeof item.name !== "string"))) {
    throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent artifacts must contain names");
  }
  const configuredDelegations = value.delegations;
  const rawDelegations = Array.isArray(configuredDelegations)
    ? configuredDelegations
    : configuredDelegations === undefined
      ? (value.delegate === undefined ? [] : [value.delegate])
      : [configuredDelegations];
  const delegations: AgentDelegationRequest[] = rawDelegations.map((request) => {
    if (!isRecord(request) || typeof request.message !== "string" || !request.message.trim()) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Each configured delegation must contain a message");
    }
    const hasTarget = typeof request.targetAgent === "string" && request.targetAgent.trim().length > 0;
    const hasSessionName = typeof request.targetSessionName === "string" && request.targetSessionName.trim().length > 0;
    const hasSelector = isRecord(request.selector);
    if ((hasTarget || hasSessionName) === hasSelector) throw adapterFault("OUTPUT_PARSE_FAILED", "", "Each delegation must select a session name/agent ID or selector");
    if (hasSessionName && (request.targetSessionName as string).trim().length > 120) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation targetSessionName must be 120 characters or fewer");
    }
    if (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || (request.timeoutMs as number) < 0)) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation timeoutMs must be a non-negative integer");
    }
    if (request.interaction !== undefined && request.interaction !== "A2A" && request.interaction !== "A2B") {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation interaction must be A2A or A2B");
    }
    const responseForTaskId = request.responseForTaskId;
    const callbackForTaskId = request.callbackForTaskId;
    if ((responseForTaskId !== undefined && (typeof responseForTaskId !== "string" || !responseForTaskId.trim())) ||
        (callbackForTaskId !== undefined && (typeof callbackForTaskId !== "string" || !callbackForTaskId.trim()))) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation response task IDs must be non-empty strings");
    }
    if (responseForTaskId !== undefined && callbackForTaskId !== undefined) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation cannot set both responseForTaskId and callbackForTaskId");
    }
    return {
      ...(request.interaction ? { interaction: request.interaction } : {}),
      ...(hasTarget ? { targetAgent: request.targetAgent as string } : {}),
      ...(hasSessionName ? { targetSessionName: request.targetSessionName as string } : {}),
      ...(hasSelector ? { selector: request.selector as NonNullable<AgentDelegationRequest["selector"]> } : {}),
      message: request.message,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs as number }),
      ...(typeof responseForTaskId === "string" ? { responseForTaskId } : {}),
      ...(typeof callbackForTaskId === "string" ? { callbackForTaskId } : {}),
    };
  });
  return {
    result: {
      taskId: task.taskId,
      agentId: task.targetAgent,
      status: "COMPLETED",
      message: (value.message ?? value.text) as string,
      ...(Array.isArray(artifacts) ? { artifacts: artifacts as NonNullable<AgentResult["artifacts"]> } : {}),
    },
    delegations,
  };
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
