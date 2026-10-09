import type { A2AHttpServerOptions } from "./a2a-http-server.js";
import { getA2AHttpToken, getA2AHttpTokenPath } from "./a2a-http-token.js";

export type A2AHttpConfiguration = {
  serverOptions: A2AHttpServerOptions;
  tokenFilePath: string;
  tokenWasConfigured: boolean;
  roomId: string;
  roomName: string;
  mcpUrl: string;
  protocolLabel: "HTTP/SSE" | "HTTPS/SSE";
};

type MutableEnvironment = Record<string, string | undefined>;

/** Validate the enablement flag without resolving any other server settings. */
export function isA2AHttpServerEnabled(environment: Readonly<MutableEnvironment> = process.env): boolean {
  const enabled = environment.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase();
  if (enabled && enabled !== "true" && enabled !== "false") {
    throw new Error("HIVE_A2A_HTTP_ENABLED must be true or false");
  }
  return enabled !== "false";
}

/** Resolve daemon A2A HTTP settings and its transport-specific environment values. */
export async function resolveA2AHttpConfiguration(
  environment: Readonly<MutableEnvironment> = process.env,
): Promise<A2AHttpConfiguration> {
  const bind = environment.HIVE_A2A_HTTP_BIND?.trim() || "127.0.0.1:4760";
  const { host, port } = parseA2ABindAddress(bind);
  const configuredToken = environment.HIVE_A2A_HTTP_TOKEN?.trim();
  const tokenFilePath = environment.HIVE_A2A_HTTP_TOKEN_FILE?.trim() || getA2AHttpTokenPath(environment.XDG_CONFIG_HOME);
  const bearerToken = await getA2AHttpToken(configuredToken, tokenFilePath);
  const certificatePath = environment.HIVE_A2A_TLS_CERT?.trim();
  const privateKeyPath = environment.HIVE_A2A_TLS_KEY?.trim();
  if (Boolean(certificatePath) !== Boolean(privateKeyPath)) {
    throw new Error("Set both HIVE_A2A_TLS_CERT and HIVE_A2A_TLS_KEY");
  }
  const roomId = environment.HIVE_A2A_ROOM_ID?.trim() || "hive-default";
  const protocolLabel = certificatePath ? "HTTPS/SSE" : "HTTP/SSE";
  const mcpHost = isWildcardHost(host) ? "127.0.0.1" : host;
  const publicMcpUrl = environment.HIVE_A2A_MCP_PUBLIC_URL?.trim();

  return {
    serverOptions: {
      host,
      port,
      bearerToken,
      ...(certificatePath && privateKeyPath ? { tlsFiles: { certificatePath, privateKeyPath } } : {}),
    },
    tokenFilePath,
    tokenWasConfigured: Boolean(configuredToken),
    roomId,
    roomName: environment.HIVE_A2A_ROOM_NAME?.trim() || roomId,
    mcpUrl: publicMcpUrl || `${certificatePath ? "https" : "http"}://${formatHost(mcpHost)}:${port}/mcp`,
    protocolLabel,
  };
}

/** Temporarily expose the local MCP endpoint to provider adapters for the server lifetime. */
export function createA2AHttpToolEnvironment(environment: MutableEnvironment = process.env): {
  apply(mcpUrl: string, bearerToken: string): void;
  restore(): void;
} {
  let previous: { url?: string; token?: string } | undefined;
  return {
    apply(mcpUrl, bearerToken) {
      previous ??= {
        ...(environment.HIVE_A2A_MCP_URL ? { url: environment.HIVE_A2A_MCP_URL } : {}),
        ...(environment.HIVE_A2A_HTTP_TOKEN ? { token: environment.HIVE_A2A_HTTP_TOKEN } : {}),
      };
      environment.HIVE_A2A_MCP_URL = mcpUrl;
      environment.HIVE_A2A_HTTP_TOKEN = bearerToken;
    },
    restore() {
      if (!previous) return;
      if (previous.url === undefined) delete environment.HIVE_A2A_MCP_URL;
      else environment.HIVE_A2A_MCP_URL = previous.url;
      if (previous.token === undefined) delete environment.HIVE_A2A_HTTP_TOKEN;
      else environment.HIVE_A2A_HTTP_TOKEN = previous.token;
      previous = undefined;
    },
  };
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
