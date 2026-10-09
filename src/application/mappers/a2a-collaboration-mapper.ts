import type {
  AgentInput,
  AgentResult,
  AgentSelector,
  AgentTask,
  AgentTaskRecord,
  RoutingPolicy,
} from "../../domain/collaboration/aggregates/task.js";
import { DEFAULT_ROUTING_POLICY } from "../../domain/collaboration/aggregates/task.js";
import type {
  A2AAgentInputDto,
  A2AAgentSelectorDto,
  A2ARoutingPolicyDto,
  A2AAgentSummaryDto,
  A2ARoomDto,
  A2ATaskDto,
  A2ATaskRecordDto,
  A2ATaskResultDto,
  A2ATaskWaitResultDto,
  AgentNode,
  AgentRoom,
  AgentSummary,
  A2ARegisteredAgentDto,
} from "../dto/a2a-collaboration.js";

export function toA2AAgentSummaryDto(agent: AgentSummary): A2AAgentSummaryDto {
  return { ...agent, capabilities: [...agent.capabilities] };
}

export function toA2ARegisteredAgentDto(agent: AgentNode): A2ARegisteredAgentDto {
  return { ...agent, capabilities: [...agent.capabilities] };
}

export function toA2ARoomDto(room: AgentRoom): A2ARoomDto {
  return { roomId: room.roomId, name: room.name, agentIds: [...room.agentIds], createdAt: room.createdAt };
}

export function toA2ATaskDto(task: AgentTask): A2ATaskDto {
  return {
    taskId: task.taskId,
    rootTaskId: task.rootTaskId,
    ...(task.parentTaskId !== undefined ? { parentTaskId: task.parentTaskId } : {}),
    roomId: task.roomId,
    sourceAgent: task.sourceAgent,
    targetAgent: task.targetAgent,
    type: task.type,
    message: task.message,
    depth: task.depth,
    maxDepth: task.maxDepth,
    timeoutMs: task.timeoutMs,
    createdAt: task.createdAt,
    visitedAgents: [...task.visitedAgents],
    ...(task.metadata ? { metadata: { ...task.metadata } } : {}),
  };
}

export function toA2AAgentInputDto(input: AgentInput): A2AAgentInputDto {
  return { task: toA2ATaskDto(input.task), message: input.message };
}

export function toDomainAgentSelector(selector: A2AAgentSelectorDto): AgentSelector {
  return {
    ...(selector.role !== undefined ? { role: selector.role } : {}),
    ...(selector.capabilities ? { capabilities: [...selector.capabilities] } : {}),
    ...(selector.workspace !== undefined ? { workspace: selector.workspace } : {}),
    ...(selector.provider !== undefined ? { provider: selector.provider } : {}),
  };
}

export function toDomainRoutingPolicy(overrides: Partial<A2ARoutingPolicyDto> | undefined): RoutingPolicy {
  return { ...DEFAULT_ROUTING_POLICY, ...overrides };
}

export function toDomainAgentResult(result: A2ATaskResultDto): AgentResult {
  return {
    taskId: result.taskId,
    agentId: result.agentId,
    status: result.status,
    message: result.message,
    ...(result.artifacts ? { artifacts: result.artifacts.map((artifact) => ({ ...artifact })) } : {}),
    ...(result.metadata ? { metadata: { ...result.metadata } } : {}),
  };
}

export function toA2ATaskRecordDto(record: AgentTaskRecord): A2ATaskRecordDto {
  const task = record.task;
  const result = record.result;
  const error = record.error;
  return {
    task: toA2ATaskDto(task),
    state: record.state,
    updatedAt: record.updatedAt,
    ...(result ? {
      result: {
        taskId: result.taskId,
        agentId: result.agentId,
        status: result.status,
        message: result.message,
        ...(result.artifacts ? { artifacts: result.artifacts.map((artifact) => ({ ...artifact })) } : {}),
        ...(result.metadata ? { metadata: { ...result.metadata } } : {}),
      },
    } : {}),
    ...(error ? { error: { ...error } } : {}),
  };
}

export function toAgentTaskRecord(record: A2ATaskRecordDto): AgentTaskRecord {
  return {
    task: {
      ...record.task,
      visitedAgents: [...record.task.visitedAgents],
      ...(record.task.metadata ? { metadata: { ...record.task.metadata } } : {}),
    },
    state: record.state,
    updatedAt: record.updatedAt,
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

export function toA2ATaskWaitResultDto(result: A2ATaskWaitResultDto): A2ATaskWaitResultDto {
  return {
    completed: result.completed,
    taskId: result.taskId,
    state: result.state,
    ...(result.result ? {
      result: {
        taskId: result.result.taskId,
        agentId: result.result.agentId,
        status: result.result.status,
        message: result.result.message,
        ...(result.result.artifacts ? { artifacts: result.result.artifacts.map((artifact) => ({ ...artifact })) } : {}),
        ...(result.result.metadata ? { metadata: { ...result.result.metadata } } : {}),
      },
    } : {}),
    ...(result.error ? { error: { ...result.error } } : {}),
  };
}
