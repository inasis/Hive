import { hostname } from "node:os";
import { serializeAssistantEvent } from "../interfaces/contracts/daemon-assistant-event-serializer.js";
import { serializeTerminalEvent } from "../interfaces/contracts/daemon-terminal-event-serializer.js";
import type { SerializedBridgeEvent } from "../interfaces/contracts/daemon-events.js";
import type { AssistantEvent } from "../application/ports/events.js";
import { A2AHttpServer } from "../adapters/transport/a2a-http-server.js";
import type { A2AHttpServerOptions } from "../adapters/transport/a2a-http-server.js";
import { getA2AHttpToken, getA2AHttpTokenPath } from "../adapters/transport/a2a-http-token.js";
import { createDaemonRequestDispatcher } from "../interfaces/daemon/dispatcher.js";
import { createDaemonRequestHandlers } from "../interfaces/daemon/handlers.js";
import { createAssistantRuntime } from "./assistant-runtime.js";

const daemonEventListeners = new Set<(event: SerializedBridgeEvent) => void>();
const publishBridgeEvent = (event: SerializedBridgeEvent): void => {
  for (const listener of daemonEventListeners) listener(event);
};
const publishAssistantEvent = (event: AssistantEvent): void => publishBridgeEvent(serializeAssistantEvent(event));
const runtime = createAssistantRuntime(publishAssistantEvent, (event) => publishBridgeEvent(serializeTerminalEvent(event)));
const handlers = createDaemonRequestHandlers({ ...runtime.useCases, hostName: hostname });
let a2aHttpServer: A2AHttpServer | undefined;
let previousA2AToolEnvironment: { url?: string; token?: string } | undefined;

export function subscribeDaemonEvents(listener: (event: SerializedBridgeEvent) => void): () => void {
  daemonEventListeners.add(listener);
  return () => daemonEventListeners.delete(listener);
}

export const dispatchDaemonRequest = createDaemonRequestDispatcher(handlers);

/** Start the authenticated local A2A HTTP/SSE transport as part of daemon startup. */
export async function startConfiguredA2AHttpServer(): Promise<boolean> {
  const enabled = process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase();
  if (enabled && enabled !== "true" && enabled !== "false") {
    throw new Error("HIVE_A2A_HTTP_ENABLED must be true or false");
  }
  if (enabled === "false") return false;
  if (a2aHttpServer) return true;
  const bind = process.env.HIVE_A2A_HTTP_BIND?.trim() || "127.0.0.1:4760";
  const { host, port } = parseA2ABindAddress(bind);
  const configuredToken = process.env.HIVE_A2A_HTTP_TOKEN?.trim();
  const tokenFilePath = process.env.HIVE_A2A_HTTP_TOKEN_FILE?.trim() || getA2AHttpTokenPath();
  const bearerToken = await getA2AHttpToken(configuredToken, tokenFilePath);
  const certificatePath = process.env.HIVE_A2A_TLS_CERT?.trim();
  const privateKeyPath = process.env.HIVE_A2A_TLS_KEY?.trim();
  if (Boolean(certificatePath) !== Boolean(privateKeyPath)) throw new Error("Set both HIVE_A2A_TLS_CERT and HIVE_A2A_TLS_KEY");
  const roomId = process.env.HIVE_A2A_ROOM_ID?.trim() || "hive-default";

  const serverOptions: A2AHttpServerOptions = {
    host,
    port,
    bearerToken,
    ...(certificatePath && privateKeyPath ? { tlsFiles: { certificatePath, privateKeyPath } } : {}),
  };
  const server = new A2AHttpServer(runtime.a2aRuntime, serverOptions);
  await server.listen();
  a2aHttpServer = server;
  previousA2AToolEnvironment ??= {
    ...(process.env.HIVE_A2A_MCP_URL ? { url: process.env.HIVE_A2A_MCP_URL } : {}),
    ...(process.env.HIVE_A2A_HTTP_TOKEN ? { token: process.env.HIVE_A2A_HTTP_TOKEN } : {}),
  };
  const publicMcpUrl = process.env.HIVE_A2A_MCP_PUBLIC_URL?.trim();
  const mcpHost = isWildcardHost(host) ? "127.0.0.1" : host;
  process.env.HIVE_A2A_MCP_URL = publicMcpUrl || `${certificatePath ? "https" : "http"}://${formatHost(mcpHost)}:${port}/mcp`;
  process.env.HIVE_A2A_HTTP_TOKEN = bearerToken;
  process.stdout.write(`Hive A2A ${certificatePath ? "HTTPS/SSE" : "HTTP/SSE"} listening on ${host}:${port}\n`);
  if (!configuredToken) process.stdout.write(`Hive A2A bearer token file: ${tokenFilePath}\n`);
  try {
    await runtime.a2aReady;
    const existing = runtime.a2aRuntime.listRooms().find((room) => room.roomId === roomId);
    if (!existing) await runtime.a2aRuntime.createRoom(roomId, process.env.HIVE_A2A_ROOM_NAME?.trim() || roomId);
    await runtime.a2aRuntime.discoverSessions(roomId);
    process.stdout.write(`Hive A2A room ready: ${roomId}\n`);
  } catch (error) {
    a2aHttpServer = undefined;
    await server.close();
    restoreA2AToolEnvironment();
    throw error;
  }
  return true;
}

export async function stopA2AHttpServer(): Promise<void> {
  const server = a2aHttpServer;
  a2aHttpServer = undefined;
  await server?.close();
  restoreA2AToolEnvironment();
}

function restoreA2AToolEnvironment(): void {
  if (!previousA2AToolEnvironment) return;
  if (previousA2AToolEnvironment.url === undefined) delete process.env.HIVE_A2A_MCP_URL;
  else process.env.HIVE_A2A_MCP_URL = previousA2AToolEnvironment.url;
  if (previousA2AToolEnvironment.token === undefined) delete process.env.HIVE_A2A_HTTP_TOKEN;
  else process.env.HIVE_A2A_HTTP_TOKEN = previousA2AToolEnvironment.token;
  previousA2AToolEnvironment = undefined;
}

export async function warmOpenCodeProvider(): Promise<void> {
  await runtime.warmOpenCodeProvider();
}

export async function stopOpenCodeProvider(): Promise<void> {
  await runtime.stopOpenCodeProvider();
}

function parseA2ABindAddress(value: string): { host: string; port: number } {
  const match = value.startsWith("[") ? /^\[([^\]]+)\]:(\d+)$/.exec(value) : /^(.+):(\d+)$/.exec(value);
  const port = match ? Number(match[2]) : NaN;
  if (!match || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("HIVE_A2A_HTTP_BIND must be an address such as 127.0.0.1:4760 or [::1]:4760");
  }
  return { host: match[1]!, port };
}

function isWildcardHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::";
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

process.once("exit", runtime.terminateKiro);
