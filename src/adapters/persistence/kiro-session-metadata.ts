import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isKiroPermissionPreset, isValidKiroSessionId, validateKiroPermissionPresets } from "../providers/kiro/session-metadata.js";

type JsonObject = Record<string, unknown>;

const KIRO_CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hive");
const KIRO_ALIAS_FILE = join(KIRO_CONFIG_DIR, "kiro-session-aliases.json");
const KIRO_POLICY_FILE = join(KIRO_CONFIG_DIR, "kiro-session-policies.json");
let sessionAliases: Record<string, Record<string, string>> | undefined;
let sessionPolicies: Record<string, Record<string, string[]>> | undefined;
let metadataWrite = Promise.resolve();

export async function renameKiroSession(target: string, sessionId: string, title: string): Promise<void> {
  if (!isValidKiroSessionId(sessionId)) throw new Error("Session ID contains unsupported characters");
  const normalized = title.trim();
  if (!normalized || normalized.length > 120) throw new Error("Session name must contain 1 to 120 characters");
  const aliases = await loadKiroSessionAliases();
  aliases[target] = { ...aliases[target], [sessionId]: normalized };
  await persistKiroSessionAliases(aliases);
}

export async function forgetKiroSessionAlias(target: string, sessionId: string): Promise<void> {
  const aliases = await loadKiroSessionAliases();
  if (!aliases[target]?.[sessionId]) return;
  const next = { ...aliases[target] };
  delete next[sessionId];
  if (Object.keys(next).length) aliases[target] = next;
  else delete aliases[target];
  await persistKiroSessionAliases(aliases);
}

export async function getKiroSessionPolicyPresets(target: string, sessionId: string): Promise<string[]> {
  const policies = await loadKiroSessionPolicies();
  return [...(policies[target]?.[sessionId] ?? [])];
}

export async function saveKiroSessionPolicyPresets(target: string, sessionId: string, presets: string[]): Promise<void> {
  const validated = validateKiroPermissionPresets(presets);
  const policies = await loadKiroSessionPolicies();
  if (!validated.length) {
    await forgetKiroSessionPolicyPresets(target, sessionId);
    return;
  }
  policies[target] = { ...policies[target], [sessionId]: validated };
  await persistKiroSessionPolicies(policies);
}

export async function forgetKiroSessionPolicyPresets(target: string, sessionId: string): Promise<void> {
  const policies = await loadKiroSessionPolicies();
  if (!policies[target]?.[sessionId]) return;
  const next = { ...policies[target] };
  delete next[sessionId];
  if (Object.keys(next).length) policies[target] = next;
  else delete policies[target];
  await persistKiroSessionPolicies(policies);
}

export async function readKiroSessionAliases(): Promise<Record<string, Record<string, string>>> {
  return loadKiroSessionAliases();
}

async function loadKiroSessionAliases(): Promise<Record<string, Record<string, string>>> {
  if (sessionAliases) return sessionAliases;
  try {
    const parsed = JSON.parse(await readFile(KIRO_ALIAS_FILE, "utf8")) as unknown;
    sessionAliases = parseSessionAliases(parsed);
  } catch {
    sessionAliases = {};
  }
  return sessionAliases;
}

async function loadKiroSessionPolicies(): Promise<Record<string, Record<string, string[]>>> {
  if (sessionPolicies) return sessionPolicies;
  try {
    const parsed = JSON.parse(await readFile(KIRO_POLICY_FILE, "utf8")) as unknown;
    sessionPolicies = parseSessionPolicies(parsed);
  } catch {
    sessionPolicies = {};
  }
  return sessionPolicies;
}

function parseSessionAliases(value: unknown): Record<string, Record<string, string>> {
  const source = asObject(value);
  const aliases = Object.create(null) as Record<string, Record<string, string>>;
  if (!source) return aliases;
  for (const [target, sessionValues] of Object.entries(source)) {
    const sourceSessions = asObject(sessionValues);
    if (!target || !sourceSessions) continue;
    const sessions = Object.create(null) as Record<string, string>;
    for (const [sessionId, title] of Object.entries(sourceSessions)) {
      if (isValidKiroSessionId(sessionId) && typeof title === "string" && title.trim() && title.length <= 120) {
        sessions[sessionId] = title;
      }
    }
    if (Object.keys(sessions).length) aliases[target] = sessions;
  }
  return aliases;
}

function parseSessionPolicies(value: unknown): Record<string, Record<string, string[]>> {
  const source = asObject(value);
  const policies = Object.create(null) as Record<string, Record<string, string[]>>;
  if (!source) return policies;
  for (const [target, sessionValues] of Object.entries(source)) {
    const sourceSessions = asObject(sessionValues);
    if (!target || !sourceSessions) continue;
    const sessions = Object.create(null) as Record<string, string[]>;
    for (const [sessionId, presets] of Object.entries(sourceSessions)) {
      if (!isValidKiroSessionId(sessionId) || !Array.isArray(presets)) continue;
      const validPresets = [...new Set(presets.filter(isKiroPermissionPreset))];
      if (validPresets.length) sessions[sessionId] = validPresets;
    }
    if (Object.keys(sessions).length) policies[target] = sessions;
  }
  return policies;
}

function persistKiroSessionAliases(aliases: Record<string, Record<string, string>>): Promise<void> {
  sessionAliases = aliases;
  return persistKiroJson(KIRO_ALIAS_FILE, aliases);
}

function persistKiroSessionPolicies(policies: Record<string, Record<string, string[]>>): Promise<void> {
  sessionPolicies = policies;
  return persistKiroJson(KIRO_POLICY_FILE, policies);
}

function persistKiroJson(path: string, value: unknown): Promise<void> {
  metadataWrite = metadataWrite.catch(() => {}).then(async () => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  });
  return metadataWrite;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}
