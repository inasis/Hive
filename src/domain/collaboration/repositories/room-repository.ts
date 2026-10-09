import type { RoomAggregate } from "../aggregates/room.js";
import type { RoomId } from "../value-objects/identifiers.js";

/** Loads and stores one Room aggregate by its root identity. */
export interface RoomRepository {
  findById(id: RoomId): RoomAggregate | undefined;
  save(room: RoomAggregate): void;
}
