import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";

/** Own the loopback-authenticated control endpoint for an active daemon supervisor. */
export class DaemonSupervisorControl {
  #controlPath;
  #server;

  constructor(controlPath) {
    this.#controlPath = controlPath;
  }

  async listen(restartDaemon) {
    const token = randomBytes(32).toString("hex");
    const server = createServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/restart" ||
          !isLoopbackAddress(request.socket.remoteAddress) || !hasValidToken(request.headers.authorization, token)) {
        response.writeHead(404).end();
        return;
      }
      void restartDaemon().then(
        () => response.writeHead(202).end(),
        () => response.writeHead(500).end(),
      );
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    this.#server = server;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not start the daemon restart controller");
    await writeFile(this.#controlPath, JSON.stringify({ port: address.port, token }), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }

  async close() {
    const server = this.#server;
    if (!server) return;
    this.#server = undefined;
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

/** Ask the loopback control endpoint to restart, or clear a stale supervisor lock. */
export async function requestRestartOfRunningSupervisor(supervisorDirectory, ownerPath, controlPath) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const owner = await readJson(ownerPath);
    const control = await readJson(controlPath);
    if (control && Number.isInteger(control.port) && control.port > 0 && control.port <= 65_535 &&
        typeof control.token === "string" && /^[a-f0-9]{64}$/.test(control.token)) {
      try {
        const response = await fetch("http://127.0.0.1:" + control.port + "/restart", {
          method: "POST",
          headers: { authorization: "Bearer " + control.token },
        });
        if (response.status === 202) return true;
        throw new Error("The running daemon supervisor rejected the restart request");
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
    }
    if (owner && Number.isSafeInteger(owner.pid) && !processIsRunning(owner.pid)) {
      await rm(supervisorDirectory, { recursive: true, force: true });
      return false;
    }
    await delay(50);
  }
  throw new Error("The existing Hive daemon supervisor did not respond; it was left running.");
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function hasValidToken(header, expectedHex) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice(7), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
