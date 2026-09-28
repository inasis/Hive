import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "linux") {
  const pkgConfig = spawnSync("pkg-config", ["--cflags", "--libs", "gtk+-3.0"], {
    cwd: desktopDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (pkgConfig.status !== 0) process.exit(pkgConfig.status ?? 1);

  mkdirSync(`${desktopDir}/.hutch`, { recursive: true });
  const compile = spawnSync("c++", [
    "-std=c++17", "-O2", "scripts/gtk-settings.cpp",
    "-o", ".hutch/gtk-settings-helper",
    ...pkgConfig.stdout.trim().split(/\s+/).filter(Boolean),
  ], { cwd: desktopDir, stdio: "inherit" });
  if (compile.status !== 0) process.exit(compile.status ?? 1);
}

// npm exposes its JS entrypoint to lifecycle scripts. Invoking it through
// Node avoids Windows' inability to spawn npm.cmd directly without a shell.
const npmExecPath = process.env.npm_execpath;
const build = npmExecPath
  ? spawnSync(process.execPath, [npmExecPath, "run", "build:web"], { cwd: desktopDir, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:web"], {
    cwd: desktopDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
if (build.status !== 0) process.exit(build.status ?? 1);
