import type { AgentNode, AgentRoom, AgentSummary } from "../dto/a2a-collaboration.js";
import { RoomAggregate } from "../../domain/collaboration/aggregates/room.js";
import type { RoomRepository } from "../../domain/collaboration/repositories/room-repository.js";
import { AgentId, RoomId } from "../../domain/collaboration/value-objects/identifiers.js";
import { applyRoomAggregate, roomAggregateFromDto } from "../mappers/a2a-agent-mapper.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import { copyAgentSummary, copyRoom } from "../validation/a2a-runtime-copy.js";
import { requireNonEmpty } from "../validation/a2a-runtime-validation.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

export type A2ARoomDirectoryServices = {
  rooms: Map<string, AgentRoom>;
  agents: Map<string, AgentNode>;
  roomRepository: RoomRepository;
  assertInitialized(): void;
  readClock(): number;
  persist(): Promise<void>;
  emit(event: A2ARuntimeEvent): void;
};

/** Owns room creation and room-scoped agent queries for the A2A runtime. */
export class A2ARoomDirectory {
  constructor(private readonly services: A2ARoomDirectoryServices) {}

  getRoomForAgent(agentId: string): AgentRoom | undefined {
    for (const room of this.services.rooms.values()) {
      if (room.agentIds.includes(agentId)) return room;
    }
    return undefined;
  }

  listRooms(): AgentRoom[] {
    this.services.assertInitialized();
    return [...this.services.rooms.values()].map(copyRoom);
  }

  listAgents(roomId: string): AgentSummary[] {
    this.services.assertInitialized();
    const room = this.requireRoom(roomId);
    return room.agentIds.flatMap((agentId) => {
      const agent = this.services.agents.get(agentId);
      return agent ? [copyAgentSummary(agent)] : [];
    });
  }

  listAgentsForAgent(agentId: string): AgentSummary[] {
    this.services.assertInitialized();
    const room = [...this.services.rooms.values()].find((candidate) => candidate.agentIds.includes(agentId));
    if (!room) throw runtimeFault("INVALID_REQUEST", "", "Agent is not registered in a room");
    return this.listAgents(room.roomId);
  }

  async createRoom(roomId: string, name: string): Promise<AgentRoom> {
    this.services.assertInitialized();
    requireNonEmpty(roomId, "roomId");
    requireNonEmpty(name, "name");
    if (this.services.rooms.has(roomId)) throw runtimeFault("INVALID_REQUEST", "", "Room already exists");
    const aggregate = RoomAggregate.create(new RoomId(roomId), name, this.services.readClock());
    this.services.roomRepository.save(aggregate);
    const snapshot = aggregate.snapshot();
    const room: AgentRoom = {
      roomId: snapshot.id.value,
      name: snapshot.name,
      agentIds: [],
      createdAt: snapshot.createdAt,
    };
    this.services.rooms.set(roomId, room);
    await this.services.persist();
    this.services.emit({ type: "room.updated", room });
    return copyRoom(room);
  }

  requireRoom(roomId: string): AgentRoom {
    const room = this.findRoom(roomId);
    if (!room) throw runtimeFault("INVALID_REQUEST", "", "Room does not exist");
    return room;
  }

  findRoom(roomId: string): AgentRoom | undefined {
    return this.services.rooms.get(roomId);
  }

  addAgent(room: AgentRoom, agentId: string): AgentRoom {
    const aggregate = this.services.roomRepository.findById(new RoomId(room.roomId)) ?? roomAggregateFromDto(room);
    aggregate.addMember(new AgentId(agentId));
    this.services.roomRepository.save(aggregate);
    applyRoomAggregate(room, aggregate);
    return room;
  }
}
