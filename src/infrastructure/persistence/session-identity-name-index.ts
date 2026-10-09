import { defaultHiveSessionName } from "../../domain/session-identity.js";

/** Tracks case-insensitive session-name uniqueness for persisted identities. */
export class SessionIdentityNameIndex {
  private readonly counts = new Map<string, number>();

  createUniqueName(hiveSessionId: string): string {
    const compactId = hiveSessionId.replaceAll("-", "");
    for (let length = 8; length <= compactId.length; length += 4) {
      const name = `Hive 세션 ${compactId.slice(0, length)}`;
      if (!this.counts.has(name.toLocaleLowerCase())) return name;
    }
    return defaultHiveSessionName(hiveSessionId);
  }

  add(name: string): void {
    const key = name.toLocaleLowerCase();
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  remove(name: string): void {
    const key = name.toLocaleLowerCase();
    const count = this.counts.get(key) ?? 0;
    if (count <= 1) this.counts.delete(key);
    else this.counts.set(key, count - 1);
  }
}
