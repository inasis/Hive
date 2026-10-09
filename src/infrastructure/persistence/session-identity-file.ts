import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isHiveSessionId, type HiveSessionIdentity } from "../../domain/session-identity.js";

type IdentitySnapshotV1 = { version: 1; identities: Record<string, string> };
type IdentitySnapshotV2 = { version: 2; identities: Record<string, HiveSessionIdentity> };
type IdentitySnapshot = IdentitySnapshotV1 | IdentitySnapshotV2;

const MAX_IDENTITY_FILE_BYTES = 32 * 1024 * 1024;

/** Decode and validate the persisted session identity format; a missing file is an empty store. */
export async function readSessionIdentityFile(filePath: string): Promise<IdentitySnapshot | undefined> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new Error("Could not read Hive session identities");
  }
  if (Buffer.byteLength(contents, "utf8") > MAX_IDENTITY_FILE_BYTES) {
    throw new Error("Hive session identity file exceeds the size limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Hive session identity file is not valid JSON");
  }
  if (!isIdentitySnapshot(parsed)) throw new Error("Hive session identity file has an invalid schema");
  return parsed;
}

/** Save the current format atomically while retaining private directory and file permissions. */
export async function writeSessionIdentityFile(
  filePath: string,
  identities: ReadonlyMap<string, HiveSessionIdentity>,
): Promise<void> {
  const snapshot: IdentitySnapshotV2 = { version: 2, identities: Object.fromEntries(identities) };
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized, "utf8") > MAX_IDENTITY_FILE_BYTES) {
    throw new Error("Hive session identities exceed the size limit");
  }
  const parent = dirname(filePath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function isIdentitySnapshot(value: unknown): value is IdentitySnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if ((record.version !== 1 && record.version !== 2) || typeof record.identities !== "object" ||
      record.identities === null || Array.isArray(record.identities)) return false;
  return Object.entries(record.identities as Record<string, unknown>).every(([key, stored]) => {
    if (!/^[a-f0-9]{64}$/.test(key)) return false;
    if (record.version === 1) return typeof stored === "string" && isHiveSessionId(stored);
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return false;
    const identity = stored as Record<string, unknown>;
    return typeof identity.hiveSessionId === "string" && isHiveSessionId(identity.hiveSessionId) &&
      typeof identity.sessionName === "string" && Boolean(identity.sessionName.trim());
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
