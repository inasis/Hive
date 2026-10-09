import { randomUUID } from "node:crypto";

/** Allocates collision-free session UUIDs and owns their pending bind lifecycle. */
export class SessionIdentityReservations {
  private readonly reserved = new Set<string>();

  reserve(usedIds: ReadonlySet<string>): string {
    const value = this.createAvailableId(usedIds);
    this.reserved.add(value);
    return value;
  }

  createAvailableId(usedIds: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const value = randomUUID();
      if (!this.reserved.has(value) && !usedIds.has(value)) return value;
    }
    throw new Error("Could not allocate a unique Hive session UUID");
  }

  has(hiveSessionId: string): boolean {
    return this.reserved.has(hiveSessionId);
  }

  consume(hiveSessionId: string): void {
    this.reserved.delete(hiveSessionId);
  }

  restore(hiveSessionId: string): void {
    this.reserved.add(hiveSessionId);
  }

  release(hiveSessionId: string): void {
    this.reserved.delete(hiveSessionId);
  }
}
