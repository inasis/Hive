import type { RoomAggregate } from "../../domain/collaboration/aggregates/room.js";
import type { RoomRepository } from "../../domain/collaboration/repositories/room-repository.js";
import type { RoomId } from "../../domain/collaboration/value-objects/identifiers.js";

/** Process-local repository for Room aggregate roots. */
export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomAggregate>();

  findById(id: RoomId): RoomAggregate | undefined { return this.rooms.get(id.value); }
  save(room: RoomAggregate): void { this.rooms.set(room.id.value, room); }
}
