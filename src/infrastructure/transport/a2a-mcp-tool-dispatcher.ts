import type { IncomingMessage } from "node:http";
import type { A2AAgentToolRuntimePort } from "../../application/ports/a2a-runtime.js";
import { isRecord } from "./a2a-http-common.js";
import {
  parseA2AMcpToolRequest,
  parseOptionalA2AMcpToolString,
  parseRequiredA2AMcpToolString,
} from "./a2a-mcp-tool-request-parser.js";

/** Validates MCP tool arguments and dispatches them through the A2A runtime port. */
export class A2AMcpToolDispatcher {
  constructor(private readonly runtime: A2AAgentToolRuntimePort) {}

  async dispatch(paramsValue: unknown, url: URL, request: IncomingMessage): Promise<unknown> {
    const params = asRecord(paramsValue);
    const name = typeof params?.name === "string" ? params.name : "";
    const input = asRecord(params?.arguments) ?? {};
    const provider = headerString(request, "x-hive-provider") ?? url.searchParams.get("provider") ?? "";
    const target = headerString(request, "x-hive-target") ?? url.searchParams.get("target") ?? "";
    const nativeSessionId = readNativeSessionId(params ?? {});
    const metadataCallerAgentId = parseOptionalA2AMcpToolString(asRecord(params?._meta)?.callerAgentId, "_meta.callerAgentId");
    const argumentCallerAgentId = parseOptionalA2AMcpToolString(input.callerAgentId, "callerAgentId");
    if (metadataCallerAgentId && argumentCallerAgentId && metadataCallerAgentId !== argumentCallerAgentId) {
      throw new Error("callerAgentId does not match _meta.callerAgentId.");
    }
    const callerAgentId = argumentCallerAgentId ?? metadataCallerAgentId;

    if (name === "a2a_wait_task") {
      const taskId = parseRequiredA2AMcpToolString(input.taskId, "taskId");
      const waitMs = input.waitMs;
      if (waitMs !== undefined && (typeof waitMs !== "number" || !Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 30_000)) {
        throw new Error("waitMs must be an integer from 1 to 30000.");
      }
      const result = await this.runtime.waitForTask(taskId, typeof waitMs === "number" ? waitMs : undefined);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        ...(result.completed && result.state !== "COMPLETED" ? { isError: true } : {}),
      };
    }

    const nativeSessionSource = nativeSessionId
      ? await this.runtime.resolveNativeSessionAgent(provider, nativeSessionId)
      : undefined;
    let source = nativeSessionSource;
    if (callerAgentId) {
      if (!provider) throw new Error("provider metadata is required to verify callerAgentId.");
      const taskSource = await this.runtime.resolveActiveAgentForTask(provider, callerAgentId, nativeSessionId);
      if (!taskSource) throw new Error("callerAgentId does not identify exactly one active Hive A2A task.");
      if (source && source.agentId !== taskSource.agentId) throw new Error("callerAgentId does not match the resolved native session.");
      source = taskSource;
    } else if (!source && provider && target) {
      source = await this.runtime.resolveActiveAgentForTarget(provider, target);
    }
    if (!source) throw new Error("Hive could not identify the calling native session. Keep only one active session per provider target or reconnect the session.");

    if (name === "a2a_list") {
      await this.runtime.ensureSessionsDiscoveredForAgent(source.agentId);
      const agents = this.runtime.listAgentsForAgent(source.agentId)
        .flatMap((agent) => {
          if (agent.agentId === source.agentId || !agent.callerAgentId || !agent.sessionName?.trim()) return [];
          return [{
            targetAgent: agent.callerAgentId,
            sessionName: agent.sessionName,
            provider: agent.provider,
            ...(agent.role ? { role: agent.role } : {}),
            capabilities: agent.capabilities,
            state: agent.state,
          }];
        });
      return { content: [{ type: "text", text: JSON.stringify(agents) }] };
    }
    if (name !== "a2a_send" && name !== "a2a_reply" && name !== "a2b_send") throw new Error(`Unknown Hive A2A tool: ${name || "(missing name)"}`);
    const toolRequest = parseA2AMcpToolRequest(name, input);
    const result = nativeSessionSource && nativeSessionId
      ? await this.runtime.sendFromNativeSession(provider, nativeSessionId, toolRequest)
      : await this.runtime.sendFromAgent(source.agentId, toolRequest);
    return {
      content: [{ type: "text", text: JSON.stringify({ accepted: true, taskId: result.task.taskId, state: result.state }) }],
      ...(result.state === "FAILED" || result.state === "CANCELLED" || result.state === "TIMED_OUT" ? { isError: true } : {}),
    };
  }
}

function readNativeSessionId(params: Record<string, unknown>): string | undefined {
  const metadata = asRecord(params._meta);
  // Codex supplies its calling thread in threadId; other MCP clients may use sessionID.
  const nativeSessionId = metadata?.threadId ?? metadata?.sessionID ?? metadata?.sessionId;
  return typeof nativeSessionId === "string" && nativeSessionId.trim() ? nativeSessionId.trim() : undefined;
}

function headerString(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
