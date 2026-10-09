#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, createReadStream, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux" || (process.arch !== "x64" && process.arch !== "arm64")) {
  throw new Error("The Linux daemon package must be created on Linux x64 or arm64");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = join(root, "artifacts", "daemon");
const archiveName = `Hive-daemon-linux-${process.arch}.tar.gz`;
const archivePath = join(artifactDirectory, archiveName);
const checksumPath = `${archivePath}.sha256`;
const binaryPath = join(artifactDirectory, `hive-linux-${process.arch}`);
const packageDirectoryName = `Hive-daemon-linux-${process.arch}`;
const workDirectory = mkdtempSync(join(tmpdir(), "hive-daemon-package-"));
const stagedPackage = join(workDirectory, packageDirectoryName);

try {
  mkdirSync(stagedPackage, { recursive: true });
  copyFileSync(binaryPath, join(stagedPackage, "hive"));
  chmodSync(join(stagedPackage, "hive"), 0o755);
  copyFileSync(join(root, "LICENSE"), join(stagedPackage, "LICENSE"));
  copyFileSync(join(artifactDirectory, "NODE-LICENSE.txt"), join(stagedPackage, "NODE-LICENSE.txt"));
  copyFileSync(join(artifactDirectory, "THIRD-PARTY-NOTICES.txt"), join(stagedPackage, "THIRD-PARTY-NOTICES.txt"));
  writeFileSync(join(stagedPackage, "README.txt"), [
    `Hive daemon for Linux ${process.arch}`,
    "",
    "Requirements: 64-bit glibc-based Linux. Node.js is not required on the computer running this binary.",
    "Install the provider CLI you plan to use (for example, Codex CLI) and sign in as the same user that runs Hive.",
    "",
    "Start the daemon:",
    "  chmod +x hive",
    "  ./hive daemon",
    "",
    "To advertise a public endpoint:",
    "  ./hive daemon --public-url wss://<public-ip>:4753/rpc",
    "",
    "The daemon prints its WSS address, certificate fingerprint, and pairing token. Enter those values in the Hive client.",
    "Stop it with Ctrl+C. Generated credentials are stored under ~/.config/hive/.",
    "",
    "License texts: LICENSE, NODE-LICENSE.txt, THIRD-PARTY-NOTICES.txt.",
  ].join("\n"));

  mkdirSync(artifactDirectory, { recursive: true });
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", workDirectory, packageDirectoryName], {
    cwd: root,
    stdio: "inherit",
  });
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error(`tar failed with exit code ${tar.status ?? "unknown"}`);

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  writeFileSync(checksumPath, `${hash.digest("hex")}  ${basename(archivePath)}\n`);
  process.stdout.write(`Created ${archivePath}\nCreated ${checksumPath}\n`);
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
