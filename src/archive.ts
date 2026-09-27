import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ImportedCodexArchive = {
  format: "hive-codex-archive/v1";
  provider: "codex";
  importedAt: string;
  source: {
    sshTarget: string;
    threadId: string;
    cwd: string | null;
  };
  /** Untouched JSON-RPC result from Codex thread/read, including its history. */
  threadRead: Record<string, unknown>;
};

export function defaultArchiveDirectory(): string {
  return path.join(homedir(), ".hive", "codex-imports");
}

export async function saveArchive(
  archive: ImportedCodexArchive,
  directory = defaultArchiveDirectory(),
): Promise<string> {
  const absoluteDirectory = path.resolve(directory);
  await mkdir(absoluteDirectory, { recursive: true, mode: 0o700 });
  if (
    process.platform !== "win32" &&
    absoluteDirectory === path.resolve(defaultArchiveDirectory())
  ) {
    await chmod(absoluteDirectory, 0o700);
  }

  const safeId = archive.source.threadId.replace(/[^A-Za-z0-9_-]/g, "_");
  const stamp = archive.importedAt.replace(/[:.]/g, "-");
  const destination = path.join(absoluteDirectory, `${safeId}-${stamp}-${randomUUID()}.json`);
  const temporary = path.join(absoluteDirectory, `.${randomUUID()}.tmp`);

  await writeFile(temporary, `${JSON.stringify(archive, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  try {
    await rename(temporary, destination);
  } catch (error) {
    const { unlink } = await import("node:fs/promises");
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  if (process.platform !== "win32") await chmod(destination, 0o600);
  return destination;
}
