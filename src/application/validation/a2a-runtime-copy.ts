import type { AgentNode, AgentRoom, AgentSummary } from "../../application/dto/a2a-collaboration.js";
import type { AgentTaskRecord, TaskState } from "../../domain/collaboration/aggregates/task.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import type { AgentAdapterDescriptor } from "../ports/a2a-agent-adapter.js";

export function isTerminalTask(state: TaskState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED" || state === "TIMED_OUT";
}

export function copyRoom(room: AgentRoom): AgentRoom {
  return { ...room, agentIds: [...room.agentIds] };
}

export function copyAgent(agent: AgentNode): AgentNode {
  return { ...agent, capabilities: [...agent.capabilities] };
}

export function copyAgentSummary(agent: AgentNode): AgentSummary {
  const { adapterId: _adapterId, nativeSessionId: _nativeSessionId, ...summary } = agent;
  return { ...summary, capabilities: [...summary.capabilities] };
}

export function copyTaskRecord(record: AgentTaskRecord): AgentTaskRecord {
  return {
    ...record,
    task: {
      ...record.task,
      visitedAgents: [...record.task.visitedAgents],
      ...(record.task.metadata ? { metadata: { ...record.task.metadata } } : {}),
    },
    ...(record.result ? {
      result: {
        ...record.result,
        ...(record.result.artifacts ? { artifacts: record.result.artifacts.map((artifact) => ({ ...artifact })) } : {}),
        ...(record.result.metadata ? { metadata: { ...record.result.metadata } } : {}),
      },
    } : {}),
    ...(record.error ? { error: { ...record.error } } : {}),
  };
}

export function copyDescriptor(descriptor: AgentAdapterDescriptor): AgentAdapterDescriptor {
  return {
    ...descriptor,
    adapterId: descriptor.adapterId,
    capabilities: { ...descriptor.capabilities },
    evidence: { ...descriptor.evidence, limitations: [...descriptor.evidence.limitations] },
  };
}

export function copyEvent(event: A2ARuntimeEvent): A2ARuntimeEvent {
  if (event.type === "room.updated") return { ...event, room: copyRoom(event.room) };
  if (event.type === "agent.updated") return { ...event, agent: { ...event.agent, capabilities: [...event.agent.capabilities] } };
  return { ...event, task: copyTaskRecord(event.task) };
}
