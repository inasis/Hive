import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";
import { decodeHiveSessionAddress } from "./hive-session-agent-address.js";

type A2AEnvironment = Readonly<Record<string, string | undefined>>;

const TARGET_ENVIRONMENT_NAMES: readonly [AssistantProvider, string][] = [
  ["codex", "HIVE_A2A_CODEX_TARGETS"],
  ["opencode", "HIVE_A2A_OPENCODE_TARGETS"],
  ["kiro", "HIVE_A2A_KIRO_TARGETS"],
];

/** Read and validate explicit A2A provider targets, defaulting to each local provider target. */
export function configuredA2ATargetsFromEnvironment(
  environment: A2AEnvironment = process.env,
): Partial<Record<AssistantProvider, readonly string[]>> {
  const targets: Partial<Record<AssistantProvider, readonly string[]>> = {
    codex: [LOCAL_WORKSPACE_TARGET],
    opencode: [LOCAL_WORKSPACE_TARGET],
    kiro: [LOCAL_WORKSPACE_TARGET],
  };
  for (const [provider, environmentName] of TARGET_ENVIRONMENT_NAMES) {
    const raw = environment[environmentName]?.trim();
    if (!raw) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`${environmentName} must be a JSON array of provider targets`);
    }
    if (!isStringArrayOfNonEmptyTargets(value)) {
      throw new Error(`${environmentName} must be a JSON array of non-empty provider targets`);
    }
    targets[provider] = [...new Set(value.map((target) => target.trim()))];
  }
  return targets;
}

export function isA2AHttpToolProvisionEnabled(environment: A2AEnvironment = process.env): boolean {
  return environment.HIVE_A2A_HTTP_ENABLED?.trim().toLowerCase() !== "false";
}

/** A Codex session can delegate through the local HTTP MCP endpoint only on a local target. */
export function isCodexA2AToolConfigured(
  sessionId: string,
  environment: A2AEnvironment = process.env,
): boolean {
  const address = decodeHiveSessionAddress(sessionId);
  const endpoint = environment.HIVE_A2A_MCP_URL?.trim();
  const token = environment.HIVE_A2A_HTTP_TOKEN?.trim();
  if (!address || !endpoint || !token || !isA2AHttpToolProvisionEnabled(environment)) return false;
  if (address.target === LOCAL_WORKSPACE_TARGET) return true;
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isOpenCodeA2AToolProvisionAvailable(environment: A2AEnvironment = process.env): boolean {
  return isA2AHttpToolProvisionEnabled(environment) && !environment.HIVE_OPENCODE_URL?.trim();
}

export function isOpenCodeA2AToolConfigured(environment: A2AEnvironment = process.env): boolean {
  return isA2AHttpToolProvisionEnabled(environment)
    && Boolean(environment.HIVE_A2A_MCP_URL?.trim() && environment.HIVE_A2A_HTTP_TOKEN?.trim())
    && !environment.HIVE_OPENCODE_URL?.trim();
}

function isStringArrayOfNonEmptyTargets(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((target): target is string => typeof target === "string" && Boolean(target.trim()));
}
