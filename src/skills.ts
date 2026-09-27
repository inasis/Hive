import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { assertSshTarget, LOCAL_CODEX_TARGET } from "./codex-rpc.js";
import type { CodexAppServerApi } from "./codex-api.js";

type JsonObject = Record<string, unknown>;

export type SkillProvider = "Codex" | "Pi" | "Shared";

export type AvailableSkill = {
  name: string;
  description: string;
  path: string;
  provider: SkillProvider;
  scope: string;
  enabled: boolean;
  defaultPrompt?: string;
};

export type SkillCatalog = {
  skills: AvailableSkill[];
  warnings: string[];
};

const MAX_SKILL_FILE_BYTES = 128 * 1024;
const MAX_SCAN_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Load Codex's own inventory and Pi's conventional skill directories on the remote host. */
export async function discoverSkills(
  api: CodexAppServerApi,
  target: string,
  cwd: string | undefined,
): Promise<SkillCatalog> {
  const skills = new Map<string, AvailableSkill>();
  const warnings: string[] = [];

  try {
    const response = await api.listSkills(cwd);
    for (const entry of arrayOfObjects(asObject(response)?.data)) {
      for (const skill of arrayOfObjects(entry.skills)) {
        const parsed = parseCodexSkill(skill);
        if (parsed) skills.set(skillKey(parsed), parsed);
      }
    }
  } catch (error) {
    warnings.push(`Codex skill inventory unavailable: ${errorMessage(error)}`);
  }

  try {
    for (const skill of await listPiSkills(target, cwd)) {
      skills.set(skillKey(skill), skill);
    }
  } catch (error) {
    warnings.push(`Pi skill inventory unavailable: ${errorMessage(error)}`);
  }

  return {
    skills: [...skills.values()].sort((left, right) => {
      const providerOrder = { Codex: 0, Shared: 1, Pi: 2 };
      return (
        providerOrder[left.provider] - providerOrder[right.provider] ||
        left.scope.localeCompare(right.scope) ||
        left.name.localeCompare(right.name)
      );
    }),
    warnings,
  };
}

/** Read a Pi skill only after the user explicitly invokes it. */
export async function readPiSkill(target: string, skill: AvailableSkill): Promise<string> {
  if (skill.provider !== "Pi" || (!skill.path.startsWith("/") && target !== LOCAL_CODEX_TARGET)) {
    throw new Error("Only a discovered Pi skill can be read through this command");
  }
  const content = target === LOCAL_CODEX_TARGET
    ? await readFile(skill.path, "utf8")
    : await runRemoteCommand(target, `cat -- ${shellQuote(skill.path)}`, MAX_SKILL_FILE_BYTES);
  if (Buffer.byteLength(content, "utf8") >= MAX_SKILL_FILE_BYTES) {
    throw new Error("Pi skill entrypoint is larger than 128 KiB");
  }
  return content;
}

function parseCodexSkill(value: JsonObject): AvailableSkill | undefined {
  const name = stringValue(value.name);
  const path = stringValue(value.path);
  if (!name || !path) return undefined;

  const interfaceInfo = asObject(value.interface);
  const provider: SkillProvider = path.includes("/.agents/skills/") ? "Shared" : "Codex";
  const skill: AvailableSkill = {
    name,
    description: stringValue(value.description) ?? "No description provided",
    path,
    provider,
    scope: stringValue(value.scope)?.toUpperCase() ?? "AVAILABLE",
    enabled: value.enabled !== false,
  };
  const defaultPrompt = stringValue(interfaceInfo?.defaultPrompt);
  if (defaultPrompt) skill.defaultPrompt = defaultPrompt;
  return skill;
}

async function listPiSkills(target: string, cwd: string | undefined): Promise<AvailableSkill[]> {
  if (target === LOCAL_CODEX_TARGET) return listLocalPiSkills(cwd);
  assertSshTarget(target);
  const script = `
project_dir=${shellQuote(cwd ?? "")}
case "$project_dir" in /*) ;; *) project_dir=;; esac
{
  printf '%s\\0' "$HOME/.pi/agent/skills"
  current="$project_dir"
  while [ -n "$current" ] && [ "$current" != "/" ]; do
    printf '%s\\0' "$current/.pi/skills"
    [ -e "$current/.git" ] && break
    parent=$(dirname "$current")
    [ "$parent" = "$current" ] && break
    current="$parent"
  done
} |
while IFS= read -r -d '' root; do
  [ -d "$root" ] || continue
  find -L "$root" -type f -name '*.md' -print0 2>/dev/null
done |
while IFS= read -r -d '' file; do
  case "$file" in
    */SKILL.md) ;;
    *)
      parent=$(dirname "$file")
      case "$parent" in */.pi/agent/skills|*/.pi/skills) ;; *) continue ;; esac
      ;;
  esac
  IFS= read -r first < "$file" || true
  [ "$first" = "---" ] || continue
  name=$(sed -n 's/^name:[[:space:]]*//p' "$file" | head -n 1 | tr '\\t\\r\\n' '   ')
  description=$(sed -n 's/^description:[[:space:]]*//p' "$file" | head -n 1 | tr '\\t\\r\\n' '   ')
  [ -n "$name" ] && [ -n "$description" ] || continue
  case "$file" in
    "$HOME/.pi/agent/skills/"*) scope=USER ;;
    *) scope=PROJECT ;;
  esac
  printf '%s\\t%s\\t%s\\t%s\\n' "$name" "$description" "$file" "$scope"
done
`;

  const output = await runRemoteCommand(target, `bash -c ${shellQuote(script)}`, MAX_SCAN_OUTPUT_BYTES);
  const skills: AvailableSkill[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [rawName, rawDescription, path, scope] = line.split("\t");
    if (!rawName || !rawDescription || !path || !scope) continue;
    const name = unquoteScalar(rawName);
    const description = unquoteScalar(rawDescription);
    if (!name || !description) continue;
    skills.push({ name, description, path, scope, provider: "Pi", enabled: true });
  }
  return skills;
}

async function listLocalPiSkills(cwd: string | undefined): Promise<AvailableSkill[]> {
  const userRoot = join(homedir(), ".pi", "agent", "skills");
  const roots = [userRoot];
  let current = cwd && isAbsolutePath(cwd) ? resolve(cwd) : "";
  while (current) {
    roots.push(join(current, ".pi", "skills"));
    try {
      await stat(join(current, ".git"));
      break;
    } catch { /* continue up to the filesystem root */ }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const skills: AvailableSkill[] = [];
  const visited = new Set<string>();
  for (const root of roots) {
    await collectLocalMarkdown(root, root, skills, visited);
  }
  return skills;
}

async function collectLocalMarkdown(
  root: string,
  directory: string,
  skills: AvailableSkill[],
  visited: Set<string>,
): Promise<void> {
  if (visited.size >= 10_000) return;
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    if (visited.size >= 10_000) return;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectLocalMarkdown(root, path, skills, visited);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const directRootFile = dirname(path) === root;
    if (entry.name !== "SKILL.md" && !directRootFile) continue;
    visited.add(path);
    try {
      const metadata = await stat(path);
      if (metadata.size > MAX_SKILL_FILE_BYTES) continue;
      const content = await readFile(path, "utf8");
      const lines = content.split(/\r?\n/);
      if (lines[0] !== "---") continue;
      const end = lines.indexOf("---", 1);
      if (end < 0) continue;
      const name = lines.slice(1, end).map((line) => /^name:\s*(.*)$/.exec(line)?.[1]).find(Boolean);
      const description = lines.slice(1, end).map((line) => /^description:\s*(.*)$/.exec(line)?.[1]).find(Boolean);
      if (!name || !description) continue;
      const normalizedName = unquoteScalar(name);
      const normalizedDescription = unquoteScalar(description);
      if (!normalizedName || !normalizedDescription) continue;
      skills.push({
        name: normalizedName,
        description: normalizedDescription,
        path,
        scope: root === userRootPath() ? "USER" : "PROJECT",
        provider: "Pi",
        enabled: true,
      });
    } catch { /* ignore files that disappear or are unreadable while scanning */ }
  }
}

function userRootPath(): string {
  return join(homedir(), ".pi", "agent", "skills");
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function runRemoteCommand(target: string, command: string, maxBytes: number): Promise<string> {
  assertSshTarget(target);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        "--",
        target,
        `bash -c ${shellQuote(command)}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const stdout: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("SSH skill lookup timed out"));
    }, 20_000);

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.concat(stdout).toString("utf8"));
    };

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill("SIGTERM");
        finish(new Error("Remote skill data exceeded the size limit"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        finish(new Error(`SSH command exited (${signal ?? code ?? "unknown status"})${suffix}`));
        return;
      }
      finish();
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function skillKey(skill: AvailableSkill): string {
  return `${skill.provider}\0${skill.name}\0${skill.path}`;
}

function arrayOfObjects(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is JsonObject =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === "'" || quote === '"') && trimmed.endsWith(quote)
    ? trimmed.slice(1, -1)
    : trimmed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
