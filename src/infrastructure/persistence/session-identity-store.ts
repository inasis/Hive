import { createHash } from "node:crypto";
import type { SessionIdentityPort } from "../../application/ports/session-identities.js";
import { isHiveSessionId, type HiveSessionIdentity } from "../../domain/session-identity.js";
import { readSessionIdentityFile, writeSessionIdentityFile } from "./session-identity-file.js";
import { SessionIdentityNameIndex } from "./session-identity-name-index.js";
import { SessionIdentityReservations } from "./session-identity-reservations.js";

type StoredIdentity = HiveSessionIdentity;

/** Persists opaque session-key hashes and daemon-assigned UUID/name pairs with private file permissions. */
export class FileSessionIdentityStore implements SessionIdentityPort {
  private readonly identities = new Map<string, StoredIdentity>();
  private readonly usedIds = new Set<string>();
  private readonly identityOwners = new Map<string, string>();
  private readonly sessionNames = new SessionIdentityNameIndex();
  private readonly reservations = new SessionIdentityReservations();
  private loaded = false;
  private needsMigration = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    if (!filePath.trim()) throw new Error("Session identity file path must not be empty");
  }

  getOrCreate(provider: string, target: string, nativeSessionId: string): Promise<string> {
    return this.getOrCreateIdentity(provider, target, nativeSessionId).then((identity) => identity.hiveSessionId);
  }

  getOrCreateIdentity(
    provider: string,
    target: string,
    nativeSessionId: string,
    providerSessionName?: string,
  ): Promise<HiveSessionIdentity> {
    return this.withLock(async () => {
      await this.load();
      await this.persistMigrationIfNeeded();
      const key = identityKey(provider, target, nativeSessionId);
      const existing = this.identities.get(key);
      if (existing) {
        const sessionName = normalizedSessionName(providerSessionName);
        if (sessionName && existing.sessionName !== sessionName) {
          const previousName = existing.sessionName;
          this.sessionNames.remove(previousName);
          existing.sessionName = sessionName;
          this.sessionNames.add(sessionName);
          try {
            await this.save();
          } catch (error) {
            this.sessionNames.remove(sessionName);
            existing.sessionName = previousName;
            this.sessionNames.add(previousName);
            throw error;
          }
        }
        return { ...existing };
      }
      const hiveSessionId = this.reservations.createAvailableId(this.usedIds);
      const identity = {
        hiveSessionId,
        sessionName: normalizedSessionName(providerSessionName) ?? this.sessionNames.createUniqueName(hiveSessionId),
      };
      this.identities.set(key, identity);
      this.usedIds.add(hiveSessionId);
      this.identityOwners.set(hiveSessionId, key);
      this.sessionNames.add(identity.sessionName);
      try {
        await this.save();
      } catch (error) {
        this.identities.delete(key);
        this.usedIds.delete(hiveSessionId);
        this.identityOwners.delete(hiveSessionId);
        this.sessionNames.remove(identity.sessionName);
        throw error;
      }
      return { ...identity };
    });
  }

  reserve(): Promise<string> {
    return this.withLock(async () => {
      await this.load();
      await this.persistMigrationIfNeeded();
      return this.reservations.reserve(this.usedIds);
    });
  }

  bind(provider: string, target: string, nativeSessionId: string, hiveSessionId: string, providerSessionName?: string): Promise<string> {
    return this.bindIdentity(provider, target, nativeSessionId, hiveSessionId, providerSessionName)
      .then((identity) => identity.hiveSessionId);
  }

  bindIdentity(provider: string, target: string, nativeSessionId: string, hiveSessionId: string, providerSessionName?: string): Promise<HiveSessionIdentity> {
    return this.withLock(async () => {
      await this.load();
      await this.persistMigrationIfNeeded();
      if (!isHiveSessionId(hiveSessionId)) throw new Error("Hive session identity must be a UUID");
      const key = identityKey(provider, target, nativeSessionId);
      const existing = this.identities.get(key);
      if (existing) {
        this.reservations.release(hiveSessionId);
        const sessionName = normalizedSessionName(providerSessionName);
        if (sessionName && existing.sessionName !== sessionName) {
          const previousName = existing.sessionName;
          this.sessionNames.remove(previousName);
          existing.sessionName = sessionName;
          this.sessionNames.add(sessionName);
          try {
            await this.save();
          } catch (error) {
            this.sessionNames.remove(sessionName);
            existing.sessionName = previousName;
            this.sessionNames.add(previousName);
            throw error;
          }
        }
        return { ...existing };
      }
      const owner = this.identityOwners.get(hiveSessionId);
      if (owner && owner !== key) throw new Error("Hive session identity is already assigned to another session");
      if (!existing && !this.reservations.has(hiveSessionId)) throw new Error("Hive session identity was not reserved by this daemon");
      const identity = {
        hiveSessionId,
        sessionName: normalizedSessionName(providerSessionName) ?? this.sessionNames.createUniqueName(hiveSessionId),
      };
      this.identities.set(key, identity);
      this.usedIds.add(hiveSessionId);
      this.identityOwners.set(hiveSessionId, key);
      this.sessionNames.add(identity.sessionName);
      this.reservations.consume(hiveSessionId);
      try {
        await this.save();
      } catch (error) {
        this.identities.delete(key);
        this.usedIds.delete(hiveSessionId);
        this.identityOwners.delete(hiveSessionId);
        this.sessionNames.remove(identity.sessionName);
        this.reservations.restore(hiveSessionId);
        throw error;
      }
      return { ...identity };
    });
  }

  release(hiveSessionId: string): void {
    this.reservations.release(hiveSessionId);
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const parsed = await readSessionIdentityFile(this.filePath);
    if (!parsed) {
      this.loaded = true;
      return;
    }
    this.needsMigration = parsed.version === 1;
    for (const [key, stored] of Object.entries(parsed.identities)) {
      const identity = typeof stored === "string"
        ? { hiveSessionId: stored, sessionName: this.sessionNames.createUniqueName(stored) }
        : { ...stored };
      if (this.identities.has(key) || this.usedIds.has(identity.hiveSessionId)) {
        throw new Error("Hive session identity file contains duplicate session UUIDs");
      }
      this.identities.set(key, identity);
      this.usedIds.add(identity.hiveSessionId);
      this.identityOwners.set(identity.hiveSessionId, key);
      this.sessionNames.add(identity.sessionName);
    }
    this.loaded = true;
  }

  private async persistMigrationIfNeeded(): Promise<void> {
    if (!this.needsMigration) return;
    await this.save();
    this.needsMigration = false;
  }

  private async save(): Promise<void> {
    await writeSessionIdentityFile(this.filePath, this.identities);
  }
}

function identityKey(provider: string, target: string, nativeSessionId: string): string {
  if (![provider, target, nativeSessionId].every((part) => typeof part === "string" && part.trim())) {
    throw new Error("Provider, target, and native session ID are required for Hive session identity");
  }
  return createHash("sha256").update(JSON.stringify([provider, target, nativeSessionId])).digest("hex");
}

function normalizedSessionName(value: string | undefined): string | undefined {
  const name = value?.trim();
  return name || undefined;
}
