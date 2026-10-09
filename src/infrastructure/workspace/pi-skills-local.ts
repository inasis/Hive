import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AvailableSkill } from "../../application/ports/skills.js";
import { MAX_PI_SKILL_FILE_BYTES } from "./pi-skill-limits.js";

export async function readLocalPiSkill(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function listLocalPiSkills(cwd: string | undefined): Promise<AvailableSkill[]> {
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
      if (metadata.size > MAX_PI_SKILL_FILE_BYTES) continue;
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

function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === "'" || quote === '"') && trimmed.endsWith(quote)
    ? trimmed.slice(1, -1)
    : trimmed;
}
