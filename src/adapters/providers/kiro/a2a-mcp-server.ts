import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { parseHiveRelayTarget } from "../../transport/relay-target.js";

type JsonObject = Record<string, unknown>;

const REMOTE_MCP_PORT = 47_662;

const MCP_PROXY_SCRIPT = String.raw`
import { createInterface } from "node:readline";
const env = process.env;
const endpoint = env.HIVE_A2A_MCP_URL;
const token = env.HIVE_A2A_HTTP_TOKEN;
if (!endpoint || !token) throw new Error("Hive A2A MCP endpoint is not configured");
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const writeError = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
for await (const line of lines) {
  if (!line.trim()) continue;
  let packet;
  try { packet = JSON.parse(line); } catch { writeError(null, -32700, "Parse error"); continue; }
  if (!packet || packet.jsonrpc !== "2.0" || typeof packet.method !== "string") {
    writeError(packet?.id ?? null, -32600, "Invalid JSON-RPC request");
    continue;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Hive-Provider": env.HIVE_A2A_PROVIDER,
        "X-Hive-Target": env.HIVE_A2A_TARGET,
      },
      body: JSON.stringify(packet),
    });
    if (packet.id === undefined) continue;
    const body = await response.text();
    if (!response.ok) { writeError(packet.id, -32000, "Hive A2A endpoint returned HTTP " + response.status); continue; }
    if (body.trim()) process.stdout.write(body.trim() + "\n");
  } catch (error) {
    if (packet.id !== undefined) writeError(packet.id, -32000, error instanceof Error ? error.message : "A2A tool transport failed");
  }
}
`;

/** Build the native ACP stdio MCP server descriptor for a local or SSH Kiro session. */
export function createKiroA2AMcpServers(target: string): JsonObject[] {
  const config = resolveKiroA2AEndpoint(target);
  if (!config) return [];
  const command = target === LOCAL_WORKSPACE_TARGET
    ? process.execPath
    : process.env.HIVE_A2A_REMOTE_NODE_BIN?.trim() || "node";
  return [{
    name: "hive-a2a",
    command,
    args: ["--input-type=module", "-e", MCP_PROXY_SCRIPT],
    env: [
      { name: "HIVE_A2A_MCP_URL", value: config.endpoint },
      { name: "HIVE_A2A_HTTP_TOKEN", value: config.token },
      { name: "HIVE_A2A_PROVIDER", value: "kiro" },
      { name: "HIVE_A2A_TARGET", value: target },
    ],
  }];
}

/** SSH reverse-forward options matching the endpoint injected into a remote Kiro session. */
export function kiroA2ASshForwardArgs(target: string): string[] {
  if (target === LOCAL_WORKSPACE_TARGET || parseHiveRelayTarget(target) || process.env.HIVE_A2A_MCP_PUBLIC_URL?.trim()) return [];
  const config = localEndpointForRemoteTarget(target);
  if (!config) return [];
  const destinationHost = config.local.hostname.includes(":") ? `[${config.local.hostname}]` : config.local.hostname;
  return [
    "-o", "ExitOnForwardFailure=yes",
    "-R", `127.0.0.1:${REMOTE_MCP_PORT}:${destinationHost}:${config.local.port}`,
  ];
}

function resolveKiroA2AEndpoint(target: string): { endpoint: string; token: string } | undefined {
  if (process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() === "false") return undefined;
  const token = process.env.HIVE_A2A_HTTP_TOKEN?.trim();
  const publicEndpoint = process.env.HIVE_A2A_MCP_PUBLIC_URL?.trim();
  const base = process.env.HIVE_A2A_MCP_URL?.trim();
  if (!token || (!base && !publicEndpoint)) return undefined;
  if (target !== LOCAL_WORKSPACE_TARGET && parseHiveRelayTarget(target)) return undefined;

  let endpoint: URL;
  if (target !== LOCAL_WORKSPACE_TARGET && publicEndpoint) {
    try { endpoint = new URL(publicEndpoint); } catch { return undefined; }
    if (endpoint.protocol !== "https:") return undefined;
  } else {
    const local = parseEndpoint(base);
    if (!local) return undefined;
    if (target === LOCAL_WORKSPACE_TARGET) {
      endpoint = local.url;
    } else {
      const forwardedPort = remoteForwardAvailable() ? REMOTE_MCP_PORT : undefined;
      if (!forwardedPort) return undefined;
      endpoint = new URL(`${local.url.pathname}${local.url.search}`, `${local.url.protocol}//127.0.0.1:${forwardedPort}`);
    }
  }
  endpoint.searchParams.set("provider", "kiro");
  endpoint.searchParams.set("target", target);
  return { endpoint: endpoint.toString(), token };
}

function localEndpointForRemoteTarget(target: string): { local: URL; port: number } | undefined {
  if (target === LOCAL_WORKSPACE_TARGET || parseHiveRelayTarget(target) || process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() === "false") return undefined;
  if (!process.env.HIVE_A2A_HTTP_TOKEN?.trim()) return undefined;
  return parseEndpoint(process.env.HIVE_A2A_MCP_URL?.trim())?.transport;
}

function parseEndpoint(value: string | undefined): { url: URL; transport: { local: URL; port: number } } | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
    const local = new URL(url);
    if (local.hostname === "localhost") local.hostname = "127.0.0.1";
    return { url, transport: { local, port } };
  } catch {
    return undefined;
  }
}

function remoteForwardAvailable(): boolean {
  const endpoint = parseEndpoint(process.env.HIVE_A2A_MCP_URL?.trim());
  return endpoint !== undefined && Boolean(process.env.HIVE_A2A_HTTP_TOKEN?.trim());
}
