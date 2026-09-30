#!/usr/bin/env node

import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const daemonArgs = process.argv.slice(2);
if (daemonArgs[0] !== "daemon") {
  process.stderr.write("Usage: npm run daemon [-- --public-url <wss-url>]\n");
  process.exit(2);
}

const build = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], {
  cwd: process.cwd(),
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const configDirectory = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const supervisorDirectory = join(configDirectory, "hive", "mobile-daemon-supervisor");
const ownerPath = join(supervisorDirectory, "owner.json");
const controlPath = join(supervisorDirectory, "control.json");
await mkdir(dirname(supervisorDirectory), { recursive: true, mode: 0o700 });

for (;;) {
  try {
    await mkdir(supervisorDirectory, { mode: 0o700 });
    await becomeSupervisor();
    break;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const restarted = await requestRestartOfRunningSupervisor();
    if (restarted) break;
  }
}

async function becomeSupervisor() {
  const owner = { pid: process.pid, startedAt: Date.now() };
  await writeFile(ownerPath, JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
  const token = randomBytes(32).toString("hex");
  let child;
  let stopping = false;
  let restarting = false;
  let restartPromise;
  let shutdownPromise;

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/restart" ||
        !isLoopbackAddress(request.socket.remoteAddress) || !hasValidToken(request.headers.authorization, token)) {
      response.writeHead(404).end();
      return;
    }
    if (!restartPromise) {
      restarting = true;
      restartPromise = stopChild()
        .then(() => startChild())
        .finally(() => {
          restarting = false;
          restartPromise = undefined;
        });
    }
    void restartPromise.then(
      () => response.writeHead(202).end(),
      () => response.writeHead(500).end(),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the daemon restart controller");
  await writeFile(controlPath, JSON.stringify({ port: address.port, token }), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  async function startChild() {
    if (stopping) return;
    const next = spawn(process.execPath, ["dist/cli.js", ...daemonArgs], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child = next;
    next.once("error", (error) => {
      process.stderr.write("Could not start the Hive daemon process: " + error.message + "\n");
      void shutdown(1);
    });
    next.once("close", (code) => {
      if (child === next) child = undefined;
      if (!stopping && !restarting) void shutdown(code ?? 1);
    });
  }

  async function stopChild() {
    const current = child;
    if (!current) return;
    const exited = new Promise((resolve) => current.once("close", resolve));
    current.kill("SIGTERM");
    const stoppedGracefully = await Promise.race([exited.then(() => true), delay(15_000).then(() => false)]);
    if (!stoppedGracefully) {
      current.kill("SIGKILL");
      await exited;
    }
    if (child === current) child = undefined;
  }

  function shutdown(exitCode) {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    shutdownPromise = (async () => {
      await new Promise((resolve) => server.close(() => resolve()));
      await stopChild();
      await rm(supervisorDirectory, { recursive: true, force: true });
      process.exitCode = exitCode;
    })();
    return shutdownPromise;
  }

  process.once("SIGINT", () => { void shutdown(130); });
  process.once("SIGTERM", () => { void shutdown(143); });
  await startChild();
}

async function requestRestartOfRunningSupervisor() {
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

async function readJson(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
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

function isAlreadyExists(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
