import { createInterface } from "node:readline";

type JsonObject = Record<string, unknown>;

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
        body: JSON.stringify(packet),
      });
      if (packet.id === undefined) continue;
      const body = await response.text();
      if (!response.ok) {
        writeError(packet.id, -32000, `Hive A2A endpoint returned HTTP ${response.status}`);
        continue;
      }
      if (body.trim()) process.stdout.write(`${body.trim()}\n`);
    } catch (error) {
      if (packet.id !== undefined) writeError(packet.id, -32000, error instanceof Error ? error.message : "A2A tool transport failed");
    }
  }
}

function writeError(id: unknown, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}
