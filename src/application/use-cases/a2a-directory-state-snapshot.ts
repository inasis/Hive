import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { A2AAgentHistoryEntryDto } from "../dto/a2a-collaboration.js";
import type { A2ARuntimeSnapshot } from "../dto/a2a-runtime-snapshot.js";
import type { AgentNode, AgentRoom, NativeSession } from "../../application/dto/a2a-collaboration.js";
import {
  agentAggregateFromNode,
  applyAgentAggregate,
  applyRoomAggregate,
  roomAggregateFromDto,
} from "../mappers/a2a-agent-mapper.js";
import { AgentId, RoomId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import type { RoomRepository } from "../../domain/collaboration/repositories/room-repository.js";
import { copyAgent, copyRoom } from "../validation/a2a-runtime-copy.js";
import type { A2ASessionIdentityRestorer } from "./a2a-session-identity-restorer.js";

export type A2ADirectorySnapshot = Pick<A2ARuntimeSnapshot, "rooms" | "agents" | "sessions" | "histories">;

/** Copies and restores the persisted state owned by the runtime directory. */
export class A2ADirectoryStateSnapshot {
  constructor(
    private readonly rooms: Map<string, AgentRoom>,
    private readonly agents: Map<string, AgentNode>,
    private readonly sessions: Map<string, NativeSession>,
    private readonly histories: Map<string, A2AAgentHistoryEntryDto[]>,
    private readonly sessionIdentities: A2ASessionIdentityRestorer,
    private readonly adapterForAgent: (agent: AgentNode) => AgentAdapter | undefined,
    private readonly agentsRepository: AgentRepository,
    private readonly roomsRepository: RoomRepository,
  ) {}

  async restore(snapshot: A2ARuntimeSnapshot): Promise<boolean> {
    for (const room of snapshot.rooms) {
      const aggregate = roomAggregateFromDto(room);
      this.roomsRepository.save(aggregate);
      this.rooms.set(room.roomId, {
        roomId: room.roomId,
        name: aggregate.name,
        agentIds: aggregate.memberIds.map((agentId) => agentId.value),
        createdAt: room.createdAt,
      });
    }
    const sessionIdentityUpdated = await this.sessionIdentities.restore(snapshot);
    for (const agent of snapshot.agents) {
      if (!this.agents.has(agent.agentId)) this.agents.set(agent.agentId, copyAgent(agent));
    }
    for (const { agentId, entries } of snapshot.histories) {
      this.histories.set(agentId, entries.map((entry) => ({ ...entry })));
    }
    for (const agent of this.agents.values()) {
      const aggregate = agentAggregateFromNode(agent);
      aggregate.markUnavailable(this.adapterForAgent(agent) ? "SESSION_UNAVAILABLE" : "ADAPTER_UNAVAILABLE");
      this.agentsRepository.save(aggregate);
      applyAgentAggregate(agent, aggregate);
      delete agent.currentTaskId;
    }
    return this.agents.size > 0 || sessionIdentityUpdated;
  }

  snapshot(): A2ADirectorySnapshot {
    return {
      rooms: [...this.rooms.values()].map((room) => {
        const projection = copyRoom(room);
        const aggregate = this.roomsRepository.findById(new RoomId(room.roomId));
        if (aggregate) applyRoomAggregate(projection, aggregate);
        return projection;
      }),
      agents: [...this.agents.values()].map((agent) => {
        const projection = copyAgent(agent);
        const aggregate = this.agentsRepository.findById(new AgentId(agent.agentId));
        if (aggregate) applyAgentAggregate(projection, aggregate);
        return projection;
      }),
      sessions: [...this.sessions.entries()].map(([agentId, session]) => ({ agentId, session: { ...session } })),
      histories: [...this.histories.entries()].map(([agentId, entries]) => ({
        agentId,
        entries: entries.map((entry) => ({ ...entry })),
      })),
    };
  }
}
