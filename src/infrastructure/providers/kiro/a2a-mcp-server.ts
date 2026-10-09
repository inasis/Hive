import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import {
  resolveKiroA2AEndpoint,
  resolveKiroA2ARemoteForwardEndpoint,
} from "./kiro-a2a-mcp-endpoint.js";

type JsonObject = Record<string, unknown>;

const MCP_PROXY_SCRIPT = String.raw`
import { createInterface } from "node:readline";
const env = process.env;
const endpoint = env.HIVE_A2A_MCP_URL;
const token = env.HIVE_A2A_HTTP_TOKEN;
if (!endpoint || !token) throw new Error("Hive A2A MCP endpoint is not configured");
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const active = new Map();
const tasks = new Set();
const requestKey = id => typeof id + ":" + id;
const writeError = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
async function forward(packet) {
  const id = packet.id;
  const controller = new AbortController();
  const key = typeof id === "string" || typeof id === "number" ? requestKey(id) : undefined;
  if (key) active.set(key, controller);
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
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
      signal: controller.signal,
      body: JSON.stringify(packet),
    });
    if (id === undefined) return;
    const body = await response.text();
    if (!response.ok) { writeError(id, -32000, "Hive A2A endpoint returned HTTP " + response.status); return; }
    if (body.trim()) process.stdout.write(body.trim() + "\n");
  } catch (error) {
    if (id !== undefined && (timedOut || !controller.signal.aborted)) {
      writeError(id, -32000, timedOut ? "Hive A2A MCP request timed out" : error instanceof Error ? error.message : "A2A tool transport failed");
    }
  } finally {
    clearTimeout(timeout);
    if (key && active.get(key) === controller) active.delete(key);
  }
}
for await (const line of lines) {
  if (!line.trim()) continue;
  let packet;
  try { packet = JSON.parse(line); } catch { writeError(null, -32700, "Parse error"); continue; }
  if (!packet || packet.jsonrpc !== "2.0" || typeof packet.method !== "string") {
    writeError(packet?.id ?? null, -32600, "Invalid JSON-RPC request");
    continue;
  }
  if (packet.method === "notifications/cancelled") {
    const requestId = packet.params?.requestId;
    if (typeof requestId === "string" || typeof requestId === "number") active.get(requestKey(requestId))?.abort();
    continue;
  }
  let task;
  task = forward(packet).finally(() => tasks.delete(task));
  tasks.add(task);
}
for (const controller of active.values()) controller.abort();
await Promise.allSettled([...tasks]);
`;

/** Build the native ACP stdio MCP server descriptor for a local or SSH Kiro session. */
export function createKiroA2AMcpServers(target: string): JsonObject[] {
  const config = resolveKiroA2AEndpoint(target);
  if (!config) return [];
  const isLocalSingleExecutable = target === LOCAL_WORKSPACE_TARGET && process.argv[1] === process.execPath;
  const command = target === LOCAL_WORKSPACE_TARGET
    ? process.execPath
    : process.env.HIVE_A2A_REMOTE_NODE_BIN?.trim() || "node";
  return [{
    name: "hive-a2a",
    command,
    args: isLocalSingleExecutable ? ["a2a-mcp", "--stdio"] : ["--input-type=module", "-e", MCP_PROXY_SCRIPT],
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
  const config = resolveKiroA2ARemoteForwardEndpoint(target);
  if (!config) return [];
  const destinationHost = config.local.hostname.includes(":") ? `[${config.local.hostname}]` : config.local.hostname;
  return [
    "-o", "ExitOnForwardFailure=yes",
    "-R", `127.0.0.1:${config.remotePort}:${destinationHost}:${config.port}`,
  ];
}
