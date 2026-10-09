import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { assertSshTarget } from "../../transport/workspace-target.js";
import { runKiroSshCommand, shellQuote } from "./process.js";

export type KiroSkillInfo = { id: string; name: string; description: string; scope: string; enabled: true; path: string };

export async function listKiroSkills(target: string, cwd: string): Promise<KiroSkillInfo[]> {
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
