import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";
import { assertSshTarget } from "./workspace-target.js";
import type { CodexRpcTransport } from "./codex-rpc-transport.js";

/** Start the Codex app-server locally or over SSH. */
export async function connectCodexProcessTransport(target: string): Promise<CodexRpcTransport> {
  if (target === LOCAL_WORKSPACE_TARGET) return localTransport();
  return sshTransport(target);
}

function localTransport(): CodexRpcTransport {
  const command = process.platform === "win32" ? "codex.cmd" : "codex";
  const child: ChildProcessWithoutNullStreams = spawn(command, codexAppServerArgs(LOCAL_WORKSPACE_TARGET), {
    stdio: "pipe",
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
  return {
    input: child.stdout,
    output: child.stdin,
    stderr: child.stderr,
    label: "Local Codex app-server",
    end: () => child.stdin.end(),
    terminate: () => child.kill("SIGTERM"),
    subscribeExit: (listener) => {
      child.on("error", (error) => listener(error.message));
      child.on("exit", (code, signal) => listener(String(signal ?? code ?? "unknown status")));
    },
  };
}

function sshTransport(target: string): CodexRpcTransport {
  assertSshTarget(target);
  const a2a = remoteA2AConfig(target);
  const a2aEnvironment = a2a ? `HIVE_A2A_HTTP_TOKEN=${shellQuote(a2a.token)} ` : "";
  const appServerArgs = a2a
    ? ["app-server", ...codexConfigFlags(a2a.url)].map(shellQuote).join(" ")
    : "app-server";
  const child: ChildProcessWithoutNullStreams = spawn(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      ...(a2a ? ["-R", `127.0.0.1:${a2a.remotePort}:127.0.0.1:${a2a.localPort}`] : []),
      "--",
      target,
      `bash -lc ${shellQuote(`PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH"; for codex_bin in "$HOME"/.nvm/versions/node/*/bin/codex; do [ -x "$codex_bin" ] && PATH="$(dirname "$codex_bin"):$PATH"; done; export PATH; ${a2aEnvironment}exec codex ${appServerArgs}`)}`,
    ],
    { stdio: "pipe" },
  );
  return {
    input: child.stdout,
    output: child.stdin,
    stderr: child.stderr,
    label: "Remote Codex app-server",
    end: () => child.stdin.end(),
    terminate: () => child.kill("SIGTERM"),
    subscribeExit: (listener) => {
      child.on("error", (error) => listener(error.message));
      child.on("exit", (code, signal) => listener(String(signal ?? code ?? "unknown status")));
    },
  };
}

const CODEX_A2A_REMOTE_PORT = 47_661;

export function codexAppServerArgs(target: string): string[] {
  const url = localA2AUrl(target);
  return url ? ["app-server", ...codexConfigFlags(url)] : ["app-server"];
}

function codexConfigFlags(url: string): string[] {
  return [
    "--config", `mcp_servers.hive_a2a.url=${JSON.stringify(url)}`,
    "--config", 'mcp_servers.hive_a2a.bearer_token_env_var="HIVE_A2A_HTTP_TOKEN"',
    "--config", 'mcp_servers.hive_a2a.default_tools_approval_mode="approve"',
    "--config", "mcp_servers.hive_a2a.enabled=true",
  ];
}

function localA2AUrl(target: string): string | undefined {
  const base = process.env.HIVE_A2A_MCP_URL?.trim();
  if (!base || !process.env.HIVE_A2A_HTTP_TOKEN?.trim() || process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() === "false") return undefined;
  const url = new URL(base);
  url.searchParams.set("provider", "codex");
  url.searchParams.set("target", target);
  return url.toString();
}

function remoteA2AConfig(target: string): { url: string; token: string; localPort: number; remotePort: number } | undefined {
  const token = process.env.HIVE_A2A_HTTP_TOKEN?.trim();
  const base = process.env.HIVE_A2A_MCP_URL?.trim();
  if (!token || !base || process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() === "false") return undefined;
  let local: URL;
  try { local = new URL(base); } catch { return undefined; }
  if (local.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(local.hostname)) return undefined;
  const port = Number(local.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  const url = new URL(`${local.pathname}${local.search}`, `http://127.0.0.1:${CODEX_A2A_REMOTE_PORT}`);
  url.searchParams.set("provider", "codex");
  url.searchParams.set("target", target);
  return { url: url.toString(), token, localPort: port, remotePort: CODEX_A2A_REMOTE_PORT };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
