import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Load an explicit A2A bearer token or create a private per-user token for the local daemon. */
export async function getA2AHttpToken(configuredValue: string | undefined, configuredPath?: string): Promise<string> {
  if (configuredValue) {
    if (configuredValue.length < 32) throw new Error("HIVE_A2A_HTTP_TOKEN must contain at least 32 characters");
    return configuredValue;
  }

  const path = configuredPath?.trim() || getA2AHttpTokenPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    return await readPrivateToken(path);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const token = randomBytes(32).toString("hex");
  try {
    await writeFile(path, `${token}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
    return token;
  } catch (error) {
    if (!isAlreadyExists(error)) throw new Error("Could not create the private A2A HTTP token file");
    return await readPrivateToken(path);
  }
}

export function getA2AHttpTokenPath(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hive", "a2a-http-token");
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readPrivateToken(path: string): Promise<string> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("A2A HTTP token path must be a regular file");
  const token = (await readFile(path, "utf8")).trim();
  if (token.length < 32) throw new Error("A2A HTTP token file must contain at least 32 characters");
  await chmod(path, 0o600).catch(() => undefined);
  return token;
}
