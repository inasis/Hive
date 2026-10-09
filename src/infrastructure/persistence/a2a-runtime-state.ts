import { isA2ARuntimeSnapshot, validateA2ARuntimeSnapshotRelations } from "./a2a-runtime-snapshot.js";
import type { A2ARuntimeSnapshot } from "../../application/dto/a2a-runtime-snapshot.js";
import type { A2ARuntimeStateStore } from "../../application/ports/a2a-runtime.js";

/** Process-local state store. Supply a durable implementation when restart recovery is required. */
export class InMemoryA2ARuntimeStateStore implements A2ARuntimeStateStore {
  private snapshot: A2ARuntimeSnapshot = { rooms: [], agents: [], sessions: [], histories: [], tasks: [] };

  async load(): Promise<A2ARuntimeSnapshot> {
    validateSnapshot(this.snapshot);
    return copyA2ARuntimeSnapshot(this.snapshot);
  }

  async save(snapshot: A2ARuntimeSnapshot): Promise<void> {
    validateSnapshot(snapshot);
    this.snapshot = copyA2ARuntimeSnapshot(snapshot);
  }
}

function validateSnapshot(snapshot: unknown): asserts snapshot is A2ARuntimeSnapshot {
  if (!isA2ARuntimeSnapshot(snapshot)) throw new Error("A2A runtime state has an invalid schema");
  validateA2ARuntimeSnapshotRelations(snapshot);
}

export function copyA2ARuntimeSnapshot(snapshot: A2ARuntimeSnapshot): A2ARuntimeSnapshot {
  return {
    rooms: snapshot.rooms.map((room) => ({ ...room, agentIds: [...room.agentIds] })),
    agents: snapshot.agents.map((agent) => ({ ...agent, capabilities: [...agent.capabilities] })),
    sessions: snapshot.sessions.map(({ agentId, session }) => ({ agentId, session: { ...session } })),
    histories: snapshot.histories.map(({ agentId, entries }) => ({ agentId, entries: entries.map((entry) => ({ ...entry })) })),
    ...(snapshot.communicationPermissions ? {
      communicationPermissions: snapshot.communicationPermissions.map(({ agentId, permissions }) => ({
        agentId,
        permissions: { ...permissions },
      })),
    } : {}),
    tasks: snapshot.tasks.map((record) => ({
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
    })),
  };
}
