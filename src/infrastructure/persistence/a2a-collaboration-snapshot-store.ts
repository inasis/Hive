import type { A2ARuntimeSnapshot } from "../../application/dto/a2a-runtime-snapshot.js";
import type { A2ARuntimeStateStore } from "../../application/ports/a2a-runtime.js";
import { copyA2ARuntimeSnapshot } from "./a2a-runtime-state.js";

/** Serializes aggregate-root writes and runtime snapshot commits through one store. */
export class A2ACollaborationSnapshotStore implements A2ARuntimeStateStore {
  private snapshot: A2ARuntimeSnapshot | undefined;
  private hasCommittedSnapshot = false;
  private repositoryWritePending = false;
  private flushScheduled = false;
  private pendingRepositoryUpdates: Array<(snapshot: A2ARuntimeSnapshot) => A2ARuntimeSnapshot> = [];
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly store: A2ARuntimeStateStore) {}

  async load(): Promise<A2ARuntimeSnapshot> {
    const snapshot = await this.store.load();
    this.snapshot = copyA2ARuntimeSnapshot(snapshot);
    this.hasCommittedSnapshot = false;
    this.pendingRepositoryUpdates = [];
    return copyA2ARuntimeSnapshot(this.snapshot);
  }

  save(snapshot: A2ARuntimeSnapshot): Promise<void> {
    let current = copyA2ARuntimeSnapshot(snapshot);
    for (const update of this.pendingRepositoryUpdates) current = update(current);
    this.pendingRepositoryUpdates = [];
    this.snapshot = copyA2ARuntimeSnapshot(current);
    this.hasCommittedSnapshot = true;
    this.repositoryWritePending = false;
    return this.enqueueSave(this.snapshot);
  }

  updateSnapshot(update: (snapshot: A2ARuntimeSnapshot) => A2ARuntimeSnapshot): void {
    if (!this.snapshot) throw new Error("A2A snapshot must be loaded before repository writes");
    const next = update(this.snapshot);
    if (next === this.snapshot) return;
    this.snapshot = copyA2ARuntimeSnapshot(next);
    this.pendingRepositoryUpdates.push(update);
    if (!this.hasCommittedSnapshot) return;
    this.repositoryWritePending = true;
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (!this.repositoryWritePending || !this.snapshot) return;
      this.repositoryWritePending = false;
      this.pendingRepositoryUpdates = [];
      void this.enqueueSave(this.snapshot).catch(() => undefined);
    });
  }

  private enqueueSave(snapshot: A2ARuntimeSnapshot): Promise<void> {
    const captured = copyA2ARuntimeSnapshot(snapshot);
    const write = this.writeTail.catch(() => undefined).then(() => this.store.save(captured));
    this.writeTail = write;
    return write;
  }
}
