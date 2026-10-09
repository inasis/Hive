import { createInterface } from "node:readline";

type JsonObject = Record<string, unknown>;
const MCP_REQUEST_TIMEOUT_MS = 30_000;

/** Bridge a provider-launched stdio MCP process to the daemon's authenticated HTTP MCP endpoint. */
export async function runA2AMcpStdioProxy(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const endpoint = environment.HIVE_A2A_MCP_URL?.trim();
  const token = environment.HIVE_A2A_HTTP_TOKEN?.trim();
  const provider = environment.HIVE_A2A_PROVIDER?.trim();
  const target = environment.HIVE_A2A_TARGET?.trim();
  if (!endpoint || !token || token.length < 32 || !provider || !target) {
    throw new Error("A2A stdio MCP requires endpoint, bearer token, provider, and target environment values");
  }
  const url = new URL(endpoint);
  url.searchParams.set("provider", provider);
  url.searchParams.set("target", target);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const activeRequests = new Map<string, AbortController>();
  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: unknown;
    try { message = JSON.parse(line); } catch {
      writeError(null, -32700, "Parse error");
      continue;
    }
    const packet = asObject(message);
    if (!packet || packet.jsonrpc !== "2.0" || typeof packet.method !== "string") {
      writeError(packet?.id ?? null, -32600, "Invalid JSON-RPC request");
      continue;
    }
    if (packet.method === "notifications/cancelled") {
      const cancelled = asObject(packet.params);
      if (typeof cancelled?.requestId === "string" || typeof cancelled?.requestId === "number") {
        activeRequests.get(requestKey(cancelled.requestId))?.abort();
      }
      continue;
    }
    const controller = new AbortController();
    const key = typeof packet.id === "string" || typeof packet.id === "number" ? requestKey(packet.id) : undefined;
    if (key) activeRequests.set(key, controller);
    let timedOut = false;
    const request = (async () => {
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("Hive A2A MCP request timed out"));
      }, MCP_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "X-Hive-Provider": provider,
            "X-Hive-Target": target,
          },
          signal: controller.signal,
          body: JSON.stringify(packet),
        });
        if (packet.id === undefined) return;
        const body = await response.text();
        if (!response.ok) {
          writeError(packet.id, -32000, `Hive A2A endpoint returned HTTP ${response.status}`);
          return;
        }
        if (body.trim()) process.stdout.write(`${body.trim()}\n`);
      } catch (error) {
        if (packet.id !== undefined && (timedOut || !controller.signal.aborted)) {
          writeError(packet.id, -32000, timedOut ? "Hive A2A MCP request timed out" : error instanceof Error ? error.message : "A2A tool transport failed");
        }
      } finally {
        clearTimeout(timeout);
        if (key && activeRequests.get(key) === controller) activeRequests.delete(key);
      }
    })();
    pending.add(request);
    void request.then(() => pending.delete(request), () => pending.delete(request));
  }
  for (const controller of activeRequests.values()) controller.abort();
  await Promise.allSettled([...pending]);
}

function writeError(id: unknown, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function requestKey(id: string | number): string {
  return `${typeof id}:${id}`;
}
