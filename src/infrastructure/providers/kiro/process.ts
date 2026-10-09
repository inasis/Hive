import { spawn, type ChildProcessWithoutNullStreams, execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { assertSshTarget } from "../../transport/workspace-target.js";
import { kiroA2ASshForwardArgs } from "./a2a-mcp-server.js";

const execFile = promisify(execFileCallback);
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const CLI_TIMEOUT_MS = 20_000;

export async function runKiroCli(target: string, args: string[]): Promise<string> {
  if (target === LOCAL_WORKSPACE_TARGET) {
    const binary = await localKiroBinary();
    const { stdout } = await execFile(binary, ["chat", ...args], { timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" });
    return stdout;
  }
  const remoteArgs = ["chat", ...args].map(shellQuote).join(" ");
  const remoteCommand = `bash -lc ${shellQuote(`PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"; export PATH; exec kiro-cli ${remoteArgs}`)}`;
  return runKiroSshCommand(target, remoteCommand);
}

export async function runKiroSshCommand(target: string, remoteCommand: string): Promise<string> {
  assertSshTarget(target);
  const { stdout } = await execFile("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "--", target, remoteCommand], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    encoding: "utf8",
  });
  return stdout;
}

export async function spawnKiroAcp(target: string): Promise<{ child: ChildProcessWithoutNullStreams; label: string }> {
  if (target === LOCAL_WORKSPACE_TARGET) {
    const child = spawn(await localKiroBinary(), ["acp"], { stdio: "pipe" });
    return { child, label: "Kiro CLI" };
  }
  assertSshTarget(target);
  const remoteCommand = `bash -lc ${shellQuote('PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"; export PATH; exec kiro-cli acp')}`;
  const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", ...kiroA2ASshForwardArgs(target), "--", target, remoteCommand], { stdio: "pipe" });
  return { child, label: `Kiro CLI on ${target}` };
}

async function localKiroBinary(): Promise<string> {
  const configured = process.env.HIVE_KIRO_BIN?.trim();
  if (configured) return configured;
  for (const candidate of [join(homedir(), ".local", "bin", "kiro-cli"), join(homedir(), ".kiro", "bin", "kiro-cli")]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking; PATH may contain a package-managed installation.
    }
  }
  return process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli";
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\''")}'`;
}
