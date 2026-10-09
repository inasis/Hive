import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { PI_A2A_EXTENSION_SOURCE } from "./a2a-tool-extension-source.js";

export type PiA2AConnection = {
  endpoint: string;
  token: string;
  target: typeof LOCAL_WORKSPACE_TARGET;
};

const EXTENSION_FILENAME = ".hive-a2a-tools.js";

/** Return the authenticated local A2A endpoint Pi can reach, if it is configured safely. */
export function resolvePiA2AConnection(environment: NodeJS.ProcessEnv = process.env): PiA2AConnection | undefined {
  if (environment.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() === "false") return undefined;
  const rawEndpoint = environment.HIVE_A2A_MCP_URL?.trim();
  const token = environment.HIVE_A2A_HTTP_TOKEN?.trim();
  if (!rawEndpoint || !token || token.length < 32) return undefined;
  try {
    const endpoint = new URL(rawEndpoint);
    if ((endpoint.protocol !== "http:" && endpoint.protocol !== "https:") || endpoint.username || endpoint.password) return undefined;
    if (endpoint.protocol === "http:" && !isLoopback(endpoint.hostname)) return undefined;
    endpoint.searchParams.set("provider", "pi");
    endpoint.searchParams.set("target", LOCAL_WORKSPACE_TARGET);
    return { endpoint: endpoint.toString(), token, target: LOCAL_WORKSPACE_TARGET };
  } catch {
    return undefined;
  }
}

export function piA2AToolsConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return resolvePiA2AConnection(environment) !== undefined;
}

/** Write Pi's session-scoped tools with private permissions; credentials stay in the process environment. */
export async function ensurePiA2AExtension(sessionDirectory: string): Promise<string> {
  const path = join(sessionDirectory, EXTENSION_FILENAME);
  await writeFile(path, PI_A2A_EXTENSION_SOURCE, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}



function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}
