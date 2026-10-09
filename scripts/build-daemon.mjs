#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const minimumNode = [20, 12];
const nodeVersion = process.versions.node.split(".").map(Number);
if (process.platform !== "linux") {
  throw new Error("The daemon binary builder must run on Linux");
}
if (process.arch !== "x64" && process.arch !== "arm64") {
  throw new Error(`Unsupported Linux architecture: ${process.arch}`);
}
const unsupportedNodeVersion = nodeVersion[0] < minimumNode[0] ||
  (nodeVersion[0] === minimumNode[0] && nodeVersion[1] < minimumNode[1]) ||
  (nodeVersion[0] === 21 && nodeVersion[1] < 7);
if (unsupportedNodeVersion) {
  throw new Error("Building the daemon binary requires Node.js 20.12+, 21.7+, or 22+");
}

const require = createRequire(import.meta.url);
const nativeAddon = require.resolve(`@lydell/node-pty-linux-${process.arch}/pty.node`);
const nodeLicenseCandidates = [
  join(dirname(process.execPath), "..", "LICENSE"),
  join(dirname(process.execPath), "..", "license"),
  "/usr/share/doc/nodejs/copyright",
];
const nodeLicensePath = nodeLicenseCandidates.find((candidate) => existsSync(candidate));
if (!nodeLicensePath) {
  throw new Error("Could not find the Node.js license file required for the distributable binary");
}
const postject = join(root, "node_modules", ".bin", "postject");
const outputDirectory = join(root, "artifacts", "daemon");
const outputPath = join(outputDirectory, `hive-linux-${process.arch}`);
const stagePath = join(outputDirectory, `.hive-linux-${process.arch}-${process.pid}.tmp`);
const workDirectory = mkdtempSync(join(tmpdir(), "hive-daemon-sea-"));
const bundlePath = join(workDirectory, "hive.cjs");
const blobPath = join(workDirectory, "sea-prep.blob");
const configPath = join(workDirectory, "sea-config.json");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed${result.status === null ? "" : ` with exit code ${result.status}`}`);
}

try {
  mkdirSync(outputDirectory, { recursive: true });
  const buildResult = await build({
    entryPoints: [join(root, "apps", "cli", "src", "main.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: bundlePath,
    metafile: true,
    banner: {
      js: [
        "const __hiveModule = require('node:module');",
        "const __hiveFs = require('node:fs');",
        "const __hiveOs = require('node:os');",
        "const __hivePath = require('node:path');",
        "const __hiveEmbeddedRequire = require;",
        "const __hiveFileRequire = __hiveModule.createRequire(process.execPath);",
        "let __hivePtyDirectory;",
        "require = function(request) {",
        "  if (request === '@lydell/node-pty-linux-' + process.arch + '/pty.node') {",
        "    if (!__hivePtyDirectory) {",
        "      __hivePtyDirectory = __hiveFs.mkdtempSync(__hivePath.join(__hiveOs.tmpdir(), 'hive-pty-'));",
        "      __hiveFs.writeFileSync(__hivePath.join(__hivePtyDirectory, 'pty.node'), new Uint8Array(require('node:sea').getAsset('pty.node')), { mode: 0o600, flag: 'wx' });",
        "      process.once('exit', () => __hiveFs.rmSync(__hivePtyDirectory, { recursive: true, force: true }));",
        "    }",
        "    return __hiveFileRequire(__hivePath.join(__hivePtyDirectory, 'pty.node'));",
        "  }",
        "  return __hiveEmbeddedRequire(request);",
        "};",
      ].join("\n"),
    },
    logLevel: "info",
  });

  writeFileSync(configPath, JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
    assets: { "pty.node": nativeAddon },
  }));
  run(process.execPath, ["--experimental-sea-config", configPath]);
  copyFileSync(process.execPath, stagePath);
  run(postject, [
    stagePath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ]);
  chmodSync(stagePath, 0o755);
  renameSync(stagePath, outputPath);
  copyFileSync(nodeLicensePath, join(outputDirectory, "NODE-LICENSE.txt"));
  writeFileSync(join(outputDirectory, "THIRD-PARTY-NOTICES.txt"), buildThirdPartyNotices(buildResult.metafile.inputs, nativeAddon));
  process.stdout.write(`Built Linux daemon binary: ${outputPath}\n`);
} finally {
  rmSync(stagePath, { force: true });
  rmSync(workDirectory, { recursive: true, force: true });
}

function buildThirdPartyNotices(inputs, nativeAddonPath) {
  const packages = new Set([packageNameFromPath(nativeAddonPath)]);
  for (const input of Object.keys(inputs)) {
    const packageName = packageNameFromPath(input);
    if (packageName) packages.add(packageName);
  }
  const sections = [...packages].filter(Boolean).sort().map((packageName) => {
    const packageDirectory = join(root, "node_modules", packageName);
    const metadata = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
    const licenseFiles = readdirSync(packageDirectory)
      .filter((file) => /^(license|licence|copying|notice)(\.|$)/i.test(file))
      .sort();
    const licenseText = licenseFiles.map((file) => `${file}\n${readFileSync(join(packageDirectory, file), "utf8").trim()}`).join("\n\n");
    return `${metadata.name}@${metadata.version}\nLicense: ${formatLicense(metadata.license)}\n${licenseText || "License text was not found in the installed package."}`;
  });
  return `Third-party notices for the Hive Linux daemon binary\n\n${sections.join("\n\n---\n\n")}\n`;
}

function packageNameFromPath(path) {
  const parts = resolve(path).split("/");
  const moduleIndex = parts.lastIndexOf("node_modules");
  if (moduleIndex < 0) return undefined;
  const name = parts[moduleIndex + 1];
  if (!name) return undefined;
  if (name.startsWith("@")) {
    const scopePackage = parts[moduleIndex + 2];
    return scopePackage ? `${name}/${scopePackage}` : undefined;
  }
  return name;
}

function formatLicense(license) {
  if (typeof license === "string") return license;
  if (Array.isArray(license)) return license.map(formatLicense).join(" OR ");
  if (license && typeof license === "object" && "type" in license) return String(license.type);
  return "unspecified";
}
