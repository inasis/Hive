import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";

const REMOTE_MCP_PORT = 47_662;

/** Resolve the configured endpoint and token for a local or SSH Kiro session. */
export function resolveKiroA2AEndpoint(target: string): { endpoint: string; token: string } | undefined {
  if (process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() === "false") return undefined;
  const token = process.env.HIVE_A2A_HTTP_TOKEN?.trim();
  const publicEndpoint = process.env.HIVE_A2A_MCP_PUBLIC_URL?.trim();
  const base = process.env.HIVE_A2A_MCP_URL?.trim();
  if (!token || (!base && !publicEndpoint)) return undefined;
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

/** Resolve the local endpoint and forwarded port used by a remote Kiro MCP connection. */
export function resolveKiroA2ARemoteForwardEndpoint(target: string): { local: URL; port: number; remotePort: number } | undefined {
  if (target === LOCAL_WORKSPACE_TARGET || process.env.HIVE_A2A_MCP_PUBLIC_URL?.trim() ||
      process.env.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() === "false") return undefined;
  if (!process.env.HIVE_A2A_HTTP_TOKEN?.trim()) return undefined;
  const endpoint = parseEndpoint(process.env.HIVE_A2A_MCP_URL?.trim());
  if (!endpoint) return undefined;
  return { ...endpoint.transport, remotePort: REMOTE_MCP_PORT };
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
