import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AssistantModel } from "../../../domain/assistant.js";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { assertSshTarget } from "../../transport/workspace-target.js";
import { parseHiveRelayTarget } from "../../transport/relay-target.js";
import { isValidKiroSessionId, readKiroSessionAliases } from "./session-metadata.js";
import { runKiroCli, runKiroSshCommand, shellQuote } from "./process.js";

type JsonObject = Record<string, unknown>;
export type KiroSessionInfo = { id: string; title: string; cwd: string; updatedAt: string | number | null; preview: string };
export type KiroSkillInfo = { id: string; name: string; description: string; scope: string; enabled: true; path: string };

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
  const aliases = await readKiroSessionAliases();
  const targetAliases = aliases[target] ?? {};
  return sessions.map((session) => ({ ...session, title: targetAliases[session.id] ?? session.title }));
}

export async function listKiroSkills(target: string, cwd: string): Promise<KiroSkillInfo[]> {
  if (parseHiveRelayTarget(target)) throw new Error("Kiro는 Hive TCP 릴레이 대상에서 사용할 수 없습니다.");
  const lines = target === LOCAL_WORKSPACE_TARGET
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
  const stdout = await runKiroSshCommand(target, remoteCommand);
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

export async function listKiroModels(target: string): Promise<AssistantModel[]> {
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
  return rows.flatMap((rowValue): AssistantModel[] => {
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
    // Kiro's session catalog can lag behind a successful delete command.
    return;
  } catch (error) {
    try {
      const remaining = await listKiroSessions(target);
      if (!remaining.some((session) => session.id === sessionId)) return;
    } catch (verificationError) {
      throw new Error(`${errorMessage(error)} (Kiro 세션 삭제 여부를 확인하지 못했습니다: ${errorMessage(verificationError)})`, { cause: error });
    }
    throw error;
  }
}


function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
