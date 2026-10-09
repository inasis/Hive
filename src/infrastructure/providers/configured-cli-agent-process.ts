import { access, constants, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { adapterFault } from "./configured-cli-agent-errors.js";

export async function resolveExecutable(command: string): Promise<string | undefined> {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    try { await access(command, constants.X_OK); return command; } catch { return undefined; }
  }
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, process.platform === "win32" ? `${command}${extension}` : command);
      try { await access(candidate, constants.X_OK); return candidate; } catch { /* try the next PATH entry */ }
    }
  }
  return undefined;
}

export async function runProcess(input: {
  command: string;
  args: string[];
  cwd?: string;
  environment?: Record<string, string>;
  input?: string;
  signal: AbortSignal;
  stopOnAbort: boolean;
  maxOutputBytes: number;
  onSpawn(child: ChildProcessWithoutNullStreams): void;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  if (input.signal.aborted) throw adapterFault("PROCESS_EXITED", "", "Agent task was cancelled before process start");
  if (input.cwd) {
    try { if (!(await stat(input.cwd)).isDirectory()) throw new Error("not a directory"); }
    catch { throw adapterFault("WORKSPACE_NOT_FOUND", "", "Configured agent workspace is unavailable"); }
  }
  const child = spawn(input.command, input.args, {
    ...(input.cwd ? { cwd: input.cwd } : {}),
    env: { ...process.env, ...input.environment },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  input.onSpawn(child);
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes > input.maxOutputBytes) {
      stopChild(child);
      return;
    }
    if (target === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  const abort = (): void => { if (input.stopOnAbort) stopChild(child); };
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.input !== undefined) child.stdin.end(input.input);
  else child.stdin.end();
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode) => resolve(exitCode));
    });
    if (outputBytes > input.maxOutputBytes) throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent output exceeded its size limit");
    if (input.signal.aborted) throw adapterFault("PROCESS_EXITED", "", "Agent task was cancelled");
    return { code, stdout, stderr };
  } catch (error) {
    if (input.signal.aborted) throw adapterFault("PROCESS_EXITED", "", "Agent task was cancelled");
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw adapterFault("PROVIDER_NOT_INSTALLED", "", "Configured agent executable could not be started");
    }
    throw error;
  } finally {
    input.signal.removeEventListener("abort", abort);
  }
}

export async function runCancellationCommand(command: string, args: string[], cwd: string | undefined, environment: Record<string, string> | undefined): Promise<void> {
  const executable = await resolveExecutable(command);
  if (!executable) throw adapterFault("PROVIDER_NOT_INSTALLED", "", "Configured cancellation executable was not found");
  if (cwd) {
    try { if (!(await stat(cwd)).isDirectory()) throw new Error("not a directory"); }
    catch { throw adapterFault("WORKSPACE_NOT_FOUND", "", "Configured agent workspace is unavailable"); }
  }
  const child = spawn(executable, args, {
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ...environment },
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 10_000);
  let code: number | null;
  try {
    code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) throw adapterFault("TIMEOUT", "", "Configured cancellation command exceeded its time limit", true);
  if (code !== 0) throw adapterFault("PROVIDER_UNAVAILABLE", "", "Configured cancellation command failed", true);
}

export function stopChild(child: ChildProcessWithoutNullStreams | undefined): void {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2_000);
  forceTimer.unref();
}
