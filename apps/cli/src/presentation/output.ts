import type { CodexCliThreadRecord } from "../../../../src/application/ports/codex-cli.js";

export function printThreads(threads: CodexCliThreadRecord[]): string {
  if (threads.length === 0) return "No Codex sessions found on that host.\n";
  return threads.map((thread) => {
    const id = thread.id;
    const title = firstString(thread.title, thread.name, thread.preview) ?? "Untitled session";
    const cwd = typeof thread.cwd === "string" ? thread.cwd : "(cwd unavailable)";
    return `${id}\t${formatDate(thread.updatedAt)}\t${title}\n  ${cwd}\n`;
  }).join("");
}

export function printHelp(defaultArchiveDirectory: string): string {
  return [
    "Hive — connect to a Hive daemon over WSS or access Codex CLI sessions over SSH",
    "",
    "Usage:",
    "  hive list <ssh-target> [--cwd <remote-path>] [--limit <1..500>] [--json]",
    "  hive import <ssh-target> <thread-id> [--cwd <remote-path>] [--out-dir <local-path>]",
    "  hive resume <ssh-target> <thread-id>",
    "  hive daemon [--public-url <wss-url>]",
    "",
    "Inside a resumed session: /skills [filter], /skill:<name> [request], /help, /quit",
    "",
    "Examples:",
    "  hive list devbox --cwd /srv/work/app",
    "  hive import devbox 019abcde-1234-7000-8000-123456789abc --cwd /srv/work/app",
    "  hive resume devbox 019abcde-1234-7000-8000-123456789abc",
    "  hive daemon",
    "  hive daemon --public-url wss://203.0.113.10:4753/rpc",
    "",
    `Default archive directory: ${defaultArchiveDirectory}`,
    "The daemon starts the pinned WSS endpoint. SSH remains available for direct Codex CLI access.",
    "Codex CLI must be installed and authenticated on the Codex host.",
    "",
  ].join("\n");
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown date" : date.toISOString();
}
