export const A2A_MCP_TOOLS = [
  {
    name: "a2a_list",
    description: "Call with no arguments to list other Hive sessions. Each entry has targetAgent (the Hive session UUID), sessionName, provider, capabilities, state, and optional role. Copy targetAgent exactly into a2a_send.targetAgent or a2b_send.targetAgent.",
    inputSchema: {
      type: "object",
      properties: {
        callerAgentId: { type: "string", minLength: 1, description: "Optional caller identity from the Hive task prompt; not needed when MCP session metadata identifies the caller." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "a2a_send",
    description: "Send new work or forward a result. Required: targetAgent and message. Copy targetAgent from a2a_list. To forward a result, also include replyToTaskId. For large work, split it into independent requests and return results with replyToTaskId. Optional timeoutMs sets the execution deadline; use 0 when the duration is unknown. Returns acceptance only; do not wait or poll.",
    inputSchema: {
      type: "object",
      properties: {
        callerAgentId: { type: "string", minLength: 1, description: "Current Hive callerAgentId from the task prompt. Keep this exact value for callerAgentId." },
        targetAgent: { type: "string", minLength: 1, description: "Required. Exact targetAgent value copied from a2a_list." },
        message: { type: "string", minLength: 1, description: "Required. Work request or forwarded result." },
        replyToTaskId: { type: "string", minLength: 1, description: "Optional. Current task ID when forwarding its result." },
        timeoutMs: { type: "integer", minimum: 0, description: "Optional task execution deadline in milliseconds. Omit or set 0 for no automatic timeout; a positive value sets a deadline." },
      },
      required: ["targetAgent", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "a2a_reply",
    description: "Reply to the current task's sender. Required: replyToTaskId and message. Copy the current task ID from the task prompt. Optional timeoutMs sets the reply task deadline; use 0 when its duration is unknown. Returns acceptance only; do not wait or poll.",
    inputSchema: {
      type: "object",
      properties: {
        callerAgentId: { type: "string", minLength: 1, description: "Current Hive callerAgentId from the task prompt. Keep this exact value for callerAgentId." },
        replyToTaskId: { type: "string", minLength: 1, description: "Required. Current task ID from the task prompt." },
        message: { type: "string", minLength: 1, description: "Required. Your reply to the task sender." },
        timeoutMs: { type: "integer", minimum: 0, description: "Optional task execution deadline in milliseconds. Omit or set 0 for no automatic timeout; a positive value sets a deadline." },
      },
      required: ["replyToTaskId", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "a2b_send",
    description: "Send one bonded task to an exact targetAgent from a2a_list. That agent must answer directly and cannot delegate. Do not wait or poll.",
    inputSchema: {
      type: "object",
      properties: {
        callerAgentId: { type: "string", minLength: 1, description: "Current Hive callerAgentId from the task prompt. Keep this exact value for callerAgentId." },
        targetAgent: { type: "string", minLength: 1, description: "Exact targetAgent value copied from a2a_list." },
        message: { type: "string", minLength: 1, description: "Work request for the single bonded responder." },
        timeoutMs: { type: "integer", minimum: 0, description: "Optional task execution deadline in milliseconds. Omit or set 0 for no automatic timeout; a positive value sets a deadline." },
      },
      required: ["targetAgent", "message"],
      additionalProperties: false,
    },
  },
];
