import { spawn } from "node:child_process";
import type { AvailableSkill } from "../../application/ports/skills.js";
import { assertSshTarget } from "../transport/workspace-target.js";
import { MAX_PI_SKILL_FILE_BYTES } from "./pi-skill-limits.js";

const MAX_SCAN_OUTPUT_BYTES = 2 * 1024 * 1024;

export async function readSshPiSkill(target: string, path: string): Promise<string> {
  return runRemoteCommand(target, `cat -- ${shellQuote(path)}`, MAX_PI_SKILL_FILE_BYTES);
}

export async function listSshPiSkills(target: string, cwd: string | undefined): Promise<AvailableSkill[]> {
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

function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === "'" || quote === '"') && trimmed.endsWith(quote)
    ? trimmed.slice(1, -1)
    : trimmed;
}
