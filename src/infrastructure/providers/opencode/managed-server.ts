import { spawn, type ChildProcess } from "node:child_process";
import { openCodeAuthorization, probeOpenCodeApi } from "./api.js";
import { injectHiveA2AMcpServer } from "./a2a-mcp-config.js";
import { MANAGED_OPENCODE_HOST, selectManagedOpenCodePort } from "./managed-server-port.js";

const START_TIMEOUT_MS = 30_000;

export type OpenCodeServerConfig = {
  endpoint: string;
  username: string;
  password?: string;
};

/** Starts and stops Hive's local OpenCode server process, including its readiness probe. */
export class ManagedOpenCodeServer {
  private child: ChildProcess | undefined;
  private config: OpenCodeServerConfig | undefined;
  private starting: Promise<OpenCodeServerConfig> | undefined;

  async ensure(username: string, configuredPassword: string | undefined): Promise<OpenCodeServerConfig> {
    if (this.config && this.child && this.child.exitCode === null && this.child.signalCode === null) {
      return this.config;
    }
    if (this.starting) return this.starting;

    this.starting = this.launch(username, configuredPassword);
    try {
      this.config = await this.starting;
      return this.config;
    } catch (error) {
      this.config = undefined;
      throw error;
    } finally {
      this.starting = undefined;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.config = undefined;
    this.starting = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await terminateChild(child);
  }

  terminate(): void {
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  private async launch(username: string, configuredPassword: string | undefined): Promise<OpenCodeServerConfig> {
    const port = await selectManagedOpenCodePort();
    const endpoint = `http://${MANAGED_OPENCODE_HOST}:${port}`;
    const command = process.env.HIVE_OPENCODE_BIN?.trim() || "opencode";
    const childEnvironment: NodeJS.ProcessEnv = { ...process.env, OPENCODE_SERVER_USERNAME: username };
    if (configuredPassword) childEnvironment.OPENCODE_SERVER_PASSWORD = configuredPassword;
    const a2aUrl = process.env.HIVE_A2A_MCP_URL?.trim();
    const a2aToken = process.env.HIVE_A2A_HTTP_TOKEN?.trim();
    if (a2aUrl && a2aToken && process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() !== "false") {
      injectHiveA2AMcpServer(childEnvironment, a2aUrl, a2aToken);
    }

    let child: ChildProcess;
    try {
      child = spawn(command, ["serve", "--hostname", MANAGED_OPENCODE_HOST, "--port", String(port)], {
        env: childEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new Error(`OpenCode CLI를 시작하지 못했습니다: ${errorMessage(error)}`);
    }
    this.child = child;

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
      if (this.child === child) {
        this.child = undefined;
        this.config = undefined;
      }
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    let lastStatus = "OpenCode server did not become ready";
    try {
      while (Date.now() < deadline) {
        if (launchError) throw new Error(`OpenCode CLI를 실행하지 못했습니다: ${launchError.message}`);
        if (child.exitCode !== null || child.signalCode !== null) {
          const status = child.signalCode ? `signal ${child.signalCode}` : `exit code ${child.exitCode}`;
          throw new Error(`OpenCode CLI가 서버 준비 전에 종료되었습니다 (${status}). CLI 설치와 ${endpoint} 포트 사용 여부를 확인하세요.`);
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
      if (this.child === child) this.child = undefined;
      await terminateChild(child);
      throw error;
    }
  }
}

function parseGeneratedPassword(output: string): string | undefined {
  const plain = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n");
  const match = /(?:^|\n)[ \t]*server password[ \t]*:?[ \t]+(\S+)/i.exec(plain);
  const value = match?.[1]?.trim();
  return value && !/^<[^>]+>$/.test(value) ? value : undefined;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
