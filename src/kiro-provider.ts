import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import type { CodexModel } from "./codex-api.js";
import { assertSshTarget, LOCAL_CODEX_TARGET } from "./codex-rpc.js";
import { parseHiveRelayTarget } from "./tcp-relay.js";

const execFile = promisify(execFileCallback);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const CLI_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 60_000;
const PROMPT_TIMEOUT_MS = 30 * 60_000;

type JsonObject = Record<string, unknown>;
export type KiroSessionUpdate = { sessionId: string; update: JsonObject };
export type KiroServerRequest = { id: number | string; method: string; params: JsonObject };
export type KiroNotification = { method: string; params: JsonObject };
export type KiroSessionInfo = { id: string; title: string; cwd: string; updatedAt: string | number | null; preview: string };
export type KiroSkillInfo = { id: string; name: string; description: string; scope: string; enabled: true; path: string };

const KIRO_PERMISSION_PRESETS = new Set([
  "allow-all", "edit-workspace", "read-workspace", "read-all", "read-only-shell", "dev-shell",
]);
const KIRO_CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hive");
const KIRO_ALIAS_FILE = join(KIRO_CONFIG_DIR, "kiro-session-aliases.json");
const KIRO_POLICY_FILE = join(KIRO_CONFIG_DIR, "kiro-session-policies.json");
let sessionAliases: Record<string, Record<string, string>> | undefined;
let sessionPolicies: Record<string, Record<string, string[]>> | undefined;
let aliasWrite = Promise.resolve();

export function isValidKiroSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

export async function listKiroSessions(target: string): Promise<KiroSessionInfo[]> {
  const output = await runKiroCli(target, ["chat", "--list-sessions", "--all-cwds", "--format", "json"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Kiro CLI returned invalid JSON while listing sessions");
  }
  if (!Array.isArray(parsed)) throw new Error("Kiro CLI returned an invalid session list");

  const sessions: KiroSessionInfo[] = [];
  for (const envelopeValue of parsed) {
    const envelope = asObject(envelopeValue);
    const cwd = stringValue(envelope?.cwd) ?? "";
    const rows = Array.isArray(envelope?.sessions) ? envelope.sessions : [];
    for (const rowValue of rows) {
      const row = asObject(rowValue);
      const id = stringValue(row?.sessionId);
      if (!row || !id || !isValidKiroSessionId(id)) continue;
      const title = stringValue(row.title);
      const count = typeof row.messageCount === "number" && row.messageCount > 0 ? `${row.messageCount}개 메시지` : "";
      sessions.push({
        id,
        title: title && title !== "(no title)" ? title : "Kiro 세션",
        cwd: stringValue(row.cwd) ?? cwd,
        updatedAt: stringValue(row.updatedAt) ?? null,
        preview: count,
      });
    }
  }
  const aliases = await loadKiroSessionAliases();
  const targetAliases = aliases[target] ?? {};
  return sessions.map((session) => ({ ...session, title: targetAliases[session.id] ?? session.title }));
}

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

export async function listKiroSkills(target: string, cwd: string): Promise<KiroSkillInfo[]> {
  if (parseHiveRelayTarget(target)) throw new Error("Kiro는 Hive TCP 릴레이 대상에서 사용할 수 없습니다.");
  const lines = target === LOCAL_CODEX_TARGET
    ? await listLocalKiroSkillLines(cwd)
    : await listRemoteKiroSkillLines(target, cwd);
  const skills = new Map<string, KiroSkillInfo>();
  for (const line of lines) {
    const [rawName, rawDescription, path, scope] = line.split("\t");
    const name = unquoteScalar(rawName ?? "");
    const description = unquoteScalar(rawDescription ?? "");
    if (!name || !path || !scope || !/^[A-Za-z0-9._-]{1,128}$/.test(name)) continue;
    skills.set(name, { id: `kiro:${name}`, name, description, path, scope, enabled: true });
  }
  return [...skills.values()].sort((left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name));
}

async function listLocalKiroSkillLines(cwd: string): Promise<string[]> {
  const kiroHome = process.env.KIRO_HOME?.trim() || join(homedir(), ".kiro");
  const roots: Array<{ path: string; scope: string }> = [{ path: join(kiroHome, "skills"), scope: "USER" }];
  let current = cwd;
  while (current && current !== "/") {
    roots.push({ path: join(current, ".kiro", "skills"), scope: "WORKSPACE" });
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const lines: string[] = [];
  for (const root of roots) {
    let directories;
    try { directories = await readdir(root.path, { withFileTypes: true }); }
    catch { continue; }
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const path = join(root.path, directory.name, "SKILL.md");
      try {
        const metadata = await stat(path);
        if (metadata.size > 128 * 1024) continue;
        lines.push(...skillMetadataLines(await readFile(path, "utf8"), path, root.scope));
      } catch { /* ignore unreadable skills */ }
    }
  }
  return lines;
}

async function listRemoteKiroSkillLines(target: string, cwd: string): Promise<string[]> {
  assertSshTarget(target);
  if (!cwd.startsWith("/")) throw new Error("Kiro workspace path must be absolute");
  const script = `
project_dir=${shellQuote(cwd)}
kiro_home="\${KIRO_HOME:-\$HOME/.kiro}"
roots=("$kiro_home/skills")
current="$project_dir"
while [ -n "$current" ] && [ "$current" != "/" ]; do
  roots+=("$current/.kiro/skills")
  [ -e "$current/.git" ] && break
  parent=$(dirname "$current")
  [ "$parent" = "$current" ] && break
  current="$parent"
done
for root in "\${roots[@]}"; do
  [ -d "$root" ] || continue
  case "$root" in "$kiro_home"/*) scope=USER ;; *) scope=WORKSPACE ;; esac
  find -L "$root" -mindepth 2 -maxdepth 2 -type f -name SKILL.md -print0 2>/dev/null |
  while IFS= read -r -d '' file; do
    name=$(sed -n 's/^name:[[:space:]]*//p' "$file" | head -n 1 | tr '\\t\\r\\n' '   ')
    description=$(sed -n 's/^description:[[:space:]]*//p' "$file" | head -n 1 | tr '\\t\\r\\n' '   ')
    [ -n "$name" ] && [ -n "$description" ] && printf '%s\\t%s\\t%s\\t%s\\n' "$name" "$description" "$file" "$scope"
  done
done
`;
  const remoteCommand = `bash -lc ${shellQuote(`PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"; export PATH; ${script}`)}`;
  const { stdout } = await execFile("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "--", target, remoteCommand], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    encoding: "utf8",
  });
  return stdout.split(/\r?\n/).filter(Boolean);
}

function skillMetadataLines(content: string, path: string, scope: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  if (end < 0) return [];
  const name = lines.slice(1, end).map((line) => /^name:\s*(.*)$/.exec(line)?.[1]).find(Boolean);
  const description = lines.slice(1, end).map((line) => /^description:\s*(.*)$/.exec(line)?.[1]).find(Boolean);
  return name ? [`${name}\t${description ?? ""}\t${path}\t${scope}`] : [];
}

function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

async function loadKiroSessionAliases(): Promise<Record<string, Record<string, string>>> {
  if (sessionAliases) return sessionAliases;
  try {
    const parsed = JSON.parse(await readFile(KIRO_ALIAS_FILE, "utf8")) as unknown;
    sessionAliases = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, Record<string, string>> : {};
  } catch {
    sessionAliases = {};
  }
  return sessionAliases;
}

async function loadKiroSessionPolicies(): Promise<Record<string, Record<string, string[]>>> {
  if (sessionPolicies) return sessionPolicies;
  try {
    const parsed = JSON.parse(await readFile(KIRO_POLICY_FILE, "utf8")) as unknown;
    sessionPolicies = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, Record<string, string[]>> : {};
  } catch {
    sessionPolicies = {};
  }
  return sessionPolicies;
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
  aliasWrite = aliasWrite.catch(() => {}).then(async () => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  });
  return aliasWrite;
}

export async function listKiroModels(target: string): Promise<CodexModel[]> {
  const output = await runKiroCli(target, ["chat", "--list-models", "--format", "json"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Kiro CLI returned invalid JSON while listing models");
  }
  const response = asObject(parsed);
  const defaultModel = stringValue(response?.default_model);
  const rows = Array.isArray(response?.models) ? response.models : [];
  return rows.flatMap((rowValue): CodexModel[] => {
    const row = asObject(rowValue);
    const model = stringValue(row?.model_id);
    if (!row || !model) return [];
    return [{
      model,
      displayName: stringValue(row.model_name) ?? model,
      description: stringValue(row.description) ?? "",
      defaultReasoningEffort: "",
      supportedReasoningEfforts: [],
      isDefault: model === defaultModel,
      hidden: false,
    }];
  });
}

export async function deleteKiroSession(target: string, sessionId: string): Promise<void> {
  if (!isValidKiroSessionId(sessionId)) throw new Error("Session ID contains unsupported characters");
  try {
    await runKiroCli(target, ["chat", "--delete-session", sessionId]);
  } catch (error) {
    try {
      const remaining = await listKiroSessions(target);
      if (remaining.some((session) => session.id === sessionId)) throw error;
    } catch (verificationError) {
      if (verificationError === error) throw error;
      throw new Error(`${errorMessage(error)} (Kiro 세션 삭제 여부를 확인하지 못했습니다: ${errorMessage(verificationError)})`, { cause: error });
    }
  }
  const remaining = await listKiroSessions(target);
  if (remaining.some((session) => session.id === sessionId)) throw new Error("Kiro CLI did not remove the session");
}

export class KiroAcpConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly updateListeners = new Map<string, Set<(update: KiroSessionUpdate) => void>>();
  private readonly requestListeners = new Set<(request: KiroServerRequest) => void>();
  private readonly notificationListeners = new Set<(notification: KiroNotification) => void>();
  private nextId = 1;
  private closed = false;
  private stderrText = "";

  private constructor(child: ChildProcessWithoutNullStreams, label: string) {
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.receiveLine(line));
    child.stderr.on("data", (chunk) => {
      this.stderrText = `${this.stderrText}${chunk.toString("utf8")}`.slice(-8_000);
    });
    child.once("error", (error) => this.failAll(new Error(`${label} 실행 실패: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (!this.closed) {
        const details = this.stderrText.trim();
        this.failAll(new Error(`${label} 프로세스가 종료되었습니다 (${signal ?? code ?? "상태 없음"})${details ? `: ${details}` : ""}`));
      }
    });
  }

  static async connect(target: string): Promise<KiroAcpConnection> {
    const { child, label } = await spawnKiroAcp(target);
    const connection = new KiroAcpConnection(child, label);
    try {
      await connection.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "hive", title: "Hive", version: "0.1.0" },
      });
      connection.notify("initialized", {});
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  onSessionUpdate(sessionId: string, listener: (update: KiroSessionUpdate) => void): () => void {
    const listeners = this.updateListeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.updateListeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.updateListeners.delete(sessionId);
    };
  }

  onServerRequest(listener: (request: KiroServerRequest) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onNotification(listener: (notification: KiroNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: number | string, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  async newSession(cwd: string, policyPresets: string[] = []): Promise<JsonObject> {
    return asObject(await this.request("session/new", {
      cwd,
      mcpServers: [],
      ...(policyPresets.length ? { _meta: { kiro: { policyPreset: validateKiroPermissionPresets(policyPresets) } } } : {}),
    })) ?? {};
  }

  async loadSession(sessionId: string, cwd: string, policyPresets: string[] = []): Promise<JsonObject> {
    if (!isValidKiroSessionId(sessionId)) throw new Error("Session ID contains unsupported characters");
    return asObject(await this.request("session/load", {
      sessionId,
      cwd,
      mcpServers: [],
      ...(policyPresets.length ? { _meta: { kiro: { policyPreset: validateKiroPermissionPresets(policyPresets) } } } : {}),
    }, 120_000)) ?? {};
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.request("session/set_model", { sessionId, modelId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.request("session/set_mode", { sessionId, modeId });
  }

  async executeCommand(sessionId: string, command: string, args: JsonObject = {}): Promise<JsonObject> {
    return asObject(await this.request("_kiro.dev/commands/execute", { sessionId, command: { command, args } })) ?? {};
  }

  async commandOptions(sessionId: string, command: string, partial = ""): Promise<JsonObject[]> {
    const result = asObject(await this.request("_kiro.dev/commands/options", { sessionId, command: command.replace(/^\/+/, ""), partial }));
    return (Array.isArray(result?.options) ? result.options : []).map(asObject).filter((option): option is JsonObject => Boolean(option));
  }

  startPrompt(sessionId: string, content: JsonObject[], onComplete: (error?: Error) => void): void {
    void this.request("session/prompt", {
      sessionId,
      prompt: content,
    }, PROMPT_TIMEOUT_MS).then(() => onComplete(), (error: unknown) => onComplete(asError(error)));
  }

  cancel(sessionId: string): void {
    this.notify("session/cancel", { sessionId });
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("Kiro ACP connection terminated"));
    this.child.kill("SIGTERM");
  }

  notify(method: string, params: JsonObject): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("Kiro ACP connection closed"));
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    const graceful = await Promise.race([exited.then(() => true), delay(1_500).then(() => false)]);
    if (!graceful && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      await Promise.race([exited, delay(1_000)]);
    }
  }

  private request<T = unknown>(method: string, params: JsonObject, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closed || this.child.exitCode !== null || this.child.signalCode !== null || !this.child.stdin.writable) {
      return Promise.reject(new Error("Kiro ACP connection is closed"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Kiro ACP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(asError(error));
      }
    });
  }

  private write(packet: JsonObject): void {
    if (this.closed || !this.child.stdin.writable) throw new Error("Kiro ACP connection is closed");
    this.child.stdin.write(`${JSON.stringify(packet)}\n`);
  }

  private receiveLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.failAll(new Error("Kiro ACP returned invalid JSON"));
      return;
    }
    const packet = asObject(parsed);
    if (!packet) {
      this.failAll(new Error("Kiro ACP returned a non-object JSON message"));
      return;
    }
    const id = typeof packet.id === "number" || typeof packet.id === "string" ? packet.id : undefined;
    if (id !== undefined && typeof packet.method === "string") {
      const request = { id, method: packet.method, params: asObject(packet.params) ?? {} };
      for (const listener of this.requestListeners) listener(request);
      return;
    }
    if (id !== undefined) {
      if (typeof id !== "number") return;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      const error = asObject(packet.error);
      if (error) pending.reject(new Error(stringValue(error.message) ?? "Kiro ACP request failed"));
      else pending.resolve(packet.result);
      return;
    }
    if (typeof packet.method !== "string") return;
    const params = asObject(packet.params) ?? {};
    if (packet.method === "session/update" || packet.method === "session/notification") {
      const sessionId = stringValue(params.sessionId);
      const update = asObject(params.update) ?? asObject(params.notification) ?? params;
      if (!sessionId) return;
      for (const listener of this.updateListeners.get(sessionId) ?? []) listener({ sessionId, update });
    }
    for (const listener of this.notificationListeners) listener({ method: packet.method, params });
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

function validateKiroPermissionPresets(presets: string[]): string[] {
  const invalid = presets.find((preset) => !KIRO_PERMISSION_PRESETS.has(preset));
  if (invalid) throw new Error(`Unknown Kiro permission preset: ${invalid}`);
  return [...new Set(presets)];
}

async function runKiroCli(target: string, args: string[]): Promise<string> {
  if (parseHiveRelayTarget(target)) throw new Error("Kiro는 Hive TCP 릴레이 대상에서 사용할 수 없습니다. 로컬 데몬이나 SSH host를 선택하세요.");
  if (target === LOCAL_CODEX_TARGET) {
    const binary = await localKiroBinary();
    const { stdout } = await execFile(binary, ["chat", ...args], { timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" });
    return stdout;
  }
  assertSshTarget(target);
  const remoteArgs = ["chat", ...args].map(shellQuote).join(" ");
  const remoteCommand = `bash -lc ${shellQuote(`PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"; export PATH; exec kiro-cli ${remoteArgs}`)}`;
  const { stdout } = await execFile("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "--", target, remoteCommand], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    encoding: "utf8",
  });
  return stdout;
}

async function spawnKiroAcp(target: string): Promise<{ child: ChildProcessWithoutNullStreams; label: string }> {
  if (parseHiveRelayTarget(target)) throw new Error("Kiro는 Hive TCP 릴레이 대상에서 사용할 수 없습니다. 로컬 데몬이나 SSH host를 선택하세요.");
  if (target === LOCAL_CODEX_TARGET) {
    const child = spawn(await localKiroBinary(), ["acp"], { stdio: "pipe" });
    return { child, label: "Kiro CLI" };
  }
  assertSshTarget(target);
  const remoteCommand = `bash -lc ${shellQuote('PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"; export PATH; exec kiro-cli acp')}`;
  const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "--", target, remoteCommand], { stdio: "pipe" });
  return { child, label: `Kiro CLI on ${target}` };
}

async function localKiroBinary(): Promise<string> {
  const configured = process.env.HIVE_KIRO_BIN?.trim();
  if (configured) return configured;
  for (const candidate of [join(homedir(), ".local", "bin", "kiro-cli"), join(homedir(), ".kiro", "bin", "kiro-cli")]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking; PATH may contain a package-managed installation.
    }
  }
  return process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
