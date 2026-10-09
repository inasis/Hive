import { AgentAggregate } from "../../domain/collaboration/aggregates/agent.js";
import { RoomAggregate } from "../../domain/collaboration/aggregates/room.js";
import { AgentId, RoomId, TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { AgentStateSnapshot } from "../../domain/collaboration/aggregates/agent.js";
import type { RoomStateSnapshot } from "../../domain/collaboration/aggregates/room.js";
import type { AgentNode, AgentRoom } from "../dto/a2a-collaboration.js";

export function agentAggregateFromNode(agent: AgentNode): AgentAggregate {
  const snapshot: AgentStateSnapshot = {
    id: new AgentId(agent.agentId),
    state: agent.state,
    capabilities: agent.capabilities,
    lastActivityAt: agent.lastActivityAt,
    ...(agent.role !== undefined ? { role: agent.role } : {}),
    ...(agent.currentTaskId ? { currentTaskId: new TaskId(agent.currentTaskId) } : {}),
    ...(agent.offlineReason ? { offlineReason: agent.offlineReason } : {}),
  };
  return AgentAggregate.reconstitute(snapshot);
}

export function applyAgentAggregate(agent: AgentNode, aggregate: AgentAggregate): void {
  const snapshot = aggregate.snapshot();
  agent.state = snapshot.state;
  agent.capabilities = [...snapshot.capabilities];
  agent.lastActivityAt = snapshot.lastActivityAt;
  if (snapshot.role !== undefined) agent.role = snapshot.role;
  else delete agent.role;
  if (snapshot.currentTaskId) agent.currentTaskId = snapshot.currentTaskId.value;
  else delete agent.currentTaskId;
  if (snapshot.offlineReason) agent.offlineReason = snapshot.offlineReason;
  else delete agent.offlineReason;
}

export function roomAggregateFromDto(room: AgentRoom): RoomAggregate {
  const snapshot: RoomStateSnapshot = {
    id: new RoomId(room.roomId),
    name: room.name,
    memberIds: room.agentIds.map((agentId) => new AgentId(agentId)),
    createdAt: room.createdAt,
  };
  return RoomAggregate.reconstitute(snapshot);
}

export function applyRoomAggregate(room: AgentRoom, aggregate: RoomAggregate): void {
  const snapshot = aggregate.snapshot();
  room.name = snapshot.name;
  room.agentIds = snapshot.memberIds.map((agentId) => agentId.value);
}
