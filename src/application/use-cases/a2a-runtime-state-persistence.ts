import type { A2ARuntimeSnapshot } from "../dto/a2a-runtime-snapshot.js";
import type { A2ACommunicationPermissionsDto } from "../dto/a2a-collaboration.js";
import type { A2ATaskSnapshotSource } from "../ports/a2a-task-snapshot-source.js";
import type { A2ARuntimeStateStore } from "../ports/a2a-runtime.js";
import type { A2ADirectorySnapshot } from "./a2a-directory-state-snapshot.js";

/** Captures Application task DTOs and directory projections into the existing runtime snapshot contract. */
export class A2ARuntimeStatePersistence {
  private persistenceTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: A2ARuntimeStateStore,
    private readonly directory: { snapshot(): A2ADirectorySnapshot },
    private readonly taskSnapshotSource: A2ATaskSnapshotSource,
    private readonly communicationPermissions: () => ReadonlyMap<string, A2ACommunicationPermissionsDto>,
  ) {}

  load(): Promise<A2ARuntimeSnapshot> {
    return this.store.load();
  }

  persist(): Promise<void> {
    const snapshot: A2ARuntimeSnapshot = {
      ...this.directory.snapshot(),
      communicationPermissions: [...this.communicationPermissions().entries()].map(([agentId, permissions]) => ({
        agentId,
        permissions: { ...permissions },
      })),
      tasks: this.taskSnapshotSource.readTaskRecordsForSnapshot().map((record) => ({
        ...record,
        task: { ...record.task, visitedAgents: [...record.task.visitedAgents] },
        ...(record.result ? { result: { ...record.result } } : {}),
        ...(record.error ? { error: { ...record.error } } : {}),
      })),
    };
    const write = this.persistenceTail.catch(() => undefined).then(() => this.store.save(snapshot));
    this.persistenceTail = write;
    return write;
  }
}
