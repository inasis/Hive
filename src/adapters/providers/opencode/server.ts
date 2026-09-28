import { spawn, type ChildProcess } from "node:child_process";
import { openCodeAuthorization, probeOpenCodeApi } from "./api.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:4096";
const START_TIMEOUT_MS = 30_000;

export type OpenCodeServerConfig = {
  endpoint: string;
  username: string;
  password?: string;
};

let managedChild: ChildProcess | undefined;
let managedConfig: OpenCodeServerConfig | undefined;
let starting: Promise<OpenCodeServerConfig> | undefined;

process.once("exit", () => {
  if (managedChild && managedChild.exitCode === null && managedChild.signalCode === null) managedChild.kill("SIGTERM");
});

/** Start a local OpenCode server if no endpoint override is configured, and return usable credentials. */
export async function ensureOpenCodeServer(): Promise<OpenCodeServerConfig> {
  const configuredEndpoint = process.env.HIVE_OPENCODE_URL?.trim();
  const username = getOpenCodeUsername();
  const password = getOpenCodePassword();
  if (configuredEndpoint) {
    return { endpoint: configuredEndpoint, username, ...(password ? { password } : {}) };
  }
  if (managedConfig && managedChild && managedChild.exitCode === null && managedChild.signalCode === null) {
    return managedConfig;
  }
  if (starting) return starting;

  starting = launchManagedServer(username, password);
  try {
    managedConfig = await starting;
    return managedConfig;
  } catch (error) {
    managedConfig = undefined;
    throw error;
  } finally {
    starting = undefined;
  }
}

export async function stopManagedOpenCodeServer(): Promise<void> {
  const child = managedChild;
  managedChild = undefined;
  managedConfig = undefined;
  starting = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await terminateChild(child);
}

function getOpenCodeUsername(): string {
  return process.env.HIVE_OPENCODE_USERNAME?.trim() || process.env.OPENCODE_SERVER_USERNAME?.trim() || "opencode";
}

function getOpenCodePassword(): string | undefined {
  return process.env.HIVE_OPENCODE_PASSWORD || process.env.OPENCODE_SERVER_PASSWORD || undefined;
}

async function launchManagedServer(username: string, configuredPassword: string | undefined): Promise<OpenCodeServerConfig> {
  const endpoint = DEFAULT_ENDPOINT;
  const command = process.env.HIVE_OPENCODE_BIN?.trim() || "opencode";
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, OPENCODE_SERVER_USERNAME: username };
  if (configuredPassword) childEnvironment.OPENCODE_SERVER_PASSWORD = configuredPassword;

  let child: ChildProcess;
  try {
    child = spawn(command, ["serve", "--hostname", "127.0.0.1", "--port", "4096"], {
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`OpenCode CLI를 시작하지 못했습니다: ${errorMessage(error)}`);
  }
  managedChild = child;

  let output = "";
  let generatedPassword: string | undefined;
  let launchError: Error | undefined;
  const captureOutput = (chunk: Buffer | string): void => {
    output = `${output}${chunk.toString()}`.slice(-32_768);
    generatedPassword ??= parseGeneratedPassword(output);
  };
  child.stdout?.on("data", captureOutput);
  child.stderr?.on("data", captureOutput);
  child.once("error", (error) => { launchError = error; });
  child.once("exit", () => {
    if (managedChild === child) {
      managedChild = undefined;
      managedConfig = undefined;
    }
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastStatus = "OpenCode server did not become ready";
  try {
    while (Date.now() < deadline) {
      if (launchError) throw new Error(`OpenCode CLI를 실행하지 못했습니다: ${launchError.message}`);
      if (child.exitCode !== null || child.signalCode !== null) {
        const status = child.signalCode ? `signal ${child.signalCode}` : `exit code ${child.exitCode}`;
        throw new Error(`OpenCode CLI가 서버 준비 전에 종료되었습니다 (${status}). CLI 설치와 4096 포트 사용 여부를 확인하세요.`);
      }

      const password = configuredPassword ?? generatedPassword;
      try {
        const probe = await probeOpenCodeApi(endpoint, openCodeAuthorization(username, password), 750);
        if (probe.version) {
          return { endpoint, username, ...(password ? { password } : {}) };
        }
        if (probe.unauthorized && !password) {
          lastStatus = "OpenCode is waiting for its generated server password";
        } else if (probe.unauthorized) {
          throw new Error("OpenCode server rejected its configured Basic-auth credentials. Check HIVE_OPENCODE_USERNAME/PASSWORD or OPENCODE_SERVER_USERNAME/PASSWORD.");
        } else {
          lastStatus = probe.lastStatus;
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("OpenCode server rejected")) throw error;
        lastStatus = error instanceof Error ? error.message : String(error);
      }
      await delay(200);
    }
    throw new Error(`${lastStatus}. OpenCode CLI did not start a healthy server at ${endpoint} within ${START_TIMEOUT_MS / 1000} seconds.`);
  } catch (error) {
    if (managedChild === child) managedChild = undefined;
    await terminateChild(child);
    throw error;
  }
}

function parseGeneratedPassword(output: string): string | undefined {
  const plain = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n");
  const match = /(?:^|\n)[ \t]*server password[ \t]*:?[ \t]+(\S+)/i.exec(plain);
  const value = match?.[1]?.trim();
  return value && !/^<[^>]+>$/.test(value) ? value : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const graceful = await Promise.race([exited.then(() => true), delay(2_000).then(() => false)]);
  if (!graceful && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(1_000)]);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
