import { AgentId, RoomId } from "../value-objects/identifiers.js";

export type RoomStateSnapshot = {
  id: RoomId;
  name: string;
  memberIds: readonly AgentId[];
  createdAt: number;
};

/** Room aggregate root. It owns ordered membership by Agent ID, never Agent entities. */
export class RoomAggregate {
  readonly id: RoomId;
  private roomName: string;
  private readonly members: AgentId[];
  private readonly creationTime: number;

  private constructor(snapshot: RoomStateSnapshot) {
    if (!snapshot.name.trim()) throw new Error("Room name must be non-empty");
    if (!Number.isFinite(snapshot.createdAt)) throw new Error("Room creation timestamp must be finite");
    const uniqueMembers = new Set(snapshot.memberIds.map((member) => member.value));
    if (uniqueMembers.size !== snapshot.memberIds.length) throw new Error("Room members must be unique");
    this.id = snapshot.id;
    this.roomName = snapshot.name;
    this.members = [...snapshot.memberIds];
    this.creationTime = snapshot.createdAt;
  }

  static create(id: RoomId, name: string, createdAt: number): RoomAggregate {
    return new RoomAggregate({ id, name, memberIds: [], createdAt });
  }

  static reconstitute(snapshot: RoomStateSnapshot): RoomAggregate {
    return new RoomAggregate(snapshot);
  }

  get name(): string { return this.roomName; }
  get memberIds(): readonly AgentId[] { return [...this.members]; }

  hasMember(agentId: AgentId): boolean {
    return this.members.some((member) => member.equals(agentId));
  }

  addMember(agentId: AgentId): void {
    if (!this.hasMember(agentId)) this.members.push(agentId);
  }

  removeMember(agentId: AgentId): void {
    const index = this.members.findIndex((member) => member.equals(agentId));
    if (index >= 0) this.members.splice(index, 1);
  }

  rename(name: string): void {
    if (!name.trim()) throw new Error("Room name must be non-empty");
    this.roomName = name;
  }

  snapshot(): RoomStateSnapshot {
    return {
      id: this.id,
      name: this.roomName,
      memberIds: [...this.members],
      createdAt: this.creationTime,
    };
  }
}
