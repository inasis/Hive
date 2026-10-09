import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isA2ARuntimeSnapshot, validateA2ARuntimeSnapshotRelations } from "./a2a-runtime-snapshot.js";
import type { A2ARuntimeSnapshot } from "../../application/dto/a2a-runtime-snapshot.js";
import type { A2ARuntimeStateStore } from "../../application/ports/a2a-runtime.js";

const MAX_STATE_BYTES = 64 * 1024 * 1024;

/** Opt-in local persistence. The file contains task messages and should be stored accordingly. */
export class FileA2ARuntimeStateStore implements A2ARuntimeStateStore {
  constructor(private readonly filePath: string) {
    if (!filePath.trim()) throw new Error("A2A state file path must not be empty");
  }

  async load(): Promise<A2ARuntimeSnapshot> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return emptySnapshot();
      throw new Error("Could not read A2A runtime state");
    }
    if (Buffer.byteLength(contents, "utf8") > MAX_STATE_BYTES) throw new Error("A2A runtime state file exceeds the size limit");
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error("A2A runtime state file is not valid JSON");
    }
    if (!isA2ARuntimeSnapshot(parsed)) throw new Error("A2A runtime state file has an invalid schema");
    validateA2ARuntimeSnapshotRelations(parsed);
    return parsed;
  }

  async save(snapshot: A2ARuntimeSnapshot): Promise<void> {
    if (!isA2ARuntimeSnapshot(snapshot)) throw new Error("A2A runtime state has an invalid schema");
    validateA2ARuntimeSnapshotRelations(snapshot);
    let serialized: string;
    try {
      serialized = JSON.stringify(snapshot);
    } catch {
      throw new Error("A2A runtime state cannot be serialized");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) throw new Error("A2A runtime state exceeds the size limit");

    const parent = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await mkdir(parent, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function emptySnapshot(): A2ARuntimeSnapshot {
  return { rooms: [], agents: [], sessions: [], histories: [], tasks: [] };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
