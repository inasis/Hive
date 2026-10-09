#!/usr/bin/env node

import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "dist");

if (dirname(outputDirectory) !== root) {
  throw new Error("Refusing to clean an unexpected TypeScript output directory");
}

rmSync(outputDirectory, { recursive: true, force: true });

const result = spawnSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(root, "tsconfig.json")], {
  cwd: root,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
