#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DaemonSupervisorControl, delay, requestRestartOfRunningSupervisor } from "./daemon-supervisor-control.mjs";

const daemonArgs = process.argv.slice(2);
if (daemonArgs[0] !== "daemon") {
  process.stderr.write("Usage: npm run daemon [-- --public-url <wss-url>]\n");
  process.exit(2);
}

const build = spawnSync(process.execPath, ["scripts/build-daemon.mjs"], {
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
    const restarted = await requestRestartOfRunningSupervisor(supervisorDirectory, ownerPath, controlPath);
    if (restarted) break;
  }
}

async function becomeSupervisor() {
  const owner = { pid: process.pid, startedAt: Date.now() };
  await writeFile(ownerPath, JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
  const control = new DaemonSupervisorControl(controlPath);
  let child;
  let stopping = false;
  let restarting = false;
  let restartPromise;
  let shutdownPromise;

  await control.listen(restartChild);

  async function startChild() {
    if (stopping) return;
    const daemonExecutable = join(process.cwd(), "artifacts", "daemon", `hive-linux-${process.arch}`);
    const next = spawn(daemonExecutable, daemonArgs, {
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

  function restartChild() {
    if (!restartPromise) {
      restarting = true;
      restartPromise = stopChild()
        .then(() => startChild())
        .finally(() => {
          restarting = false;
          restartPromise = undefined;
        });
    }
    return restartPromise;
  }

  function shutdown(exitCode) {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    shutdownPromise = (async () => {
      await control.close();
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

function isAlreadyExists(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
