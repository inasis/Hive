import type { A2ARuntimeSnapshot } from "../../domain/a2a.js";
import type { A2ARuntimeStateStore } from "../../application/ports/a2a-runtime.js";

/** Process-local state store. Supply a durable implementation when restart recovery is required. */
export class InMemoryA2ARuntimeStateStore implements A2ARuntimeStateStore {
  private snapshot: A2ARuntimeSnapshot = { rooms: [], agents: [], sessions: [], histories: [], tasks: [] };

  async load(): Promise<A2ARuntimeSnapshot> {
    return copySnapshot(this.snapshot);
  }

  async save(snapshot: A2ARuntimeSnapshot): Promise<void> {
    this.snapshot = copySnapshot(snapshot);
  }
}

function copySnapshot(snapshot: A2ARuntimeSnapshot): A2ARuntimeSnapshot {
  return {
    rooms: snapshot.rooms.map((room) => ({ ...room, agentIds: [...room.agentIds] })),
    agents: snapshot.agents.map((agent) => ({ ...agent, capabilities: [...agent.capabilities] })),
    sessions: snapshot.sessions.map(({ agentId, session }) => ({ agentId, session: { ...session } })),
    histories: snapshot.histories.map(({ agentId, entries }) => ({ agentId, entries: entries.map((entry) => ({ ...entry })) })),
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
