#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { saveArchive, defaultArchiveDirectory, type ImportedCodexArchive } from "./archive.js";
import { CodexAppServerApi, type CodexThread } from "./codex-api.js";
import { resumeCodexThread } from "./remote-resume.js";
import { runHiveRelayAgent } from "./relay-agent.js";
import { runHiveMobileDaemon } from "./mobile-daemon.js";
import { parseHiveRelayTarget, runTcpRelayServer } from "./tcp-relay.js";

type ParsedOptions = {
  cwd?: string;
  limit?: number;
  json: boolean;
  outDir?: string;
  positional: string[];
};

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "relay") {
    await relayCommand(args);
    return;
  }
  if (command === "daemon") {
    if (args[0] === "--mobile") {
      await mobileDaemonCommand(args.slice(1));
      return;
    }
    const [target] = args;
    if (!target || args.length !== 1 || !parseHiveRelayTarget(target)) {
      throw new Error("Usage: hive daemon <hive+tcp-or-tls-relay-target> | daemon --mobile [--public-url <wss-url>]");
    }
    await runHiveRelayAgent(target);
    return;
  }
  if (command === "pair") {
    pairCommand(args);
    return;
  }

  const parsed = parseOptions(args);
  if (command === "list") {
    await listCommand(parsed);
    return;
  }
  if (command === "import") {
    await importCommand(parsed);
    return;
  }
  if (command === "resume") {
    await resumeCommand(parsed);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function mobileDaemonCommand(args: string[]): Promise<void> {
  let publicUrl: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--public-url") throw new Error("Unknown mobile daemon option: " + option);
    if (publicUrl) throw new Error("--public-url can only be provided once");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--public-url requires a wss:// URL ending in /rpc");
    publicUrl = value;
    index += 1;
  }
  if (publicUrl) process.env.HIVE_MOBILE_PUBLIC_URL = publicUrl;
  await runHiveMobileDaemon();
}

function pairCommand(args: string[]): void {
  let host = "";
  let port = 47821;
  let tls = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) throw new Error("Invalid pair command arguments");
    if (argument === "--tls") {
      tls = true;
      continue;
    }
    if (argument === "--tcp") {
      tls = false;
      continue;
    }
    if (argument === "--port") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--port requires a value");
      port = Number(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new Error("Unknown pair option: " + argument);
    if (host) throw new Error("Usage: hive pair <relay-host> [--port <port>] [--tls]");
    host = argument;
  }
  if (!host) throw new Error("Usage: hive pair <relay-host> [--port <port>] [--tls]");
  const validDnsOrIpv4 = /^[A-Za-z0-9.-]+$/.test(host);
  const validIpv6 = /^\[[A-Fa-f0-9:]+\]$/.test(host);
  if (!validDnsOrIpv4 && !validIpv6) throw new Error("Relay host must be a DNS name or IP address; bracket IPv6 addresses");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be from 1 to 65535");
  const pairId = randomBytes(16).toString("hex");
  const token = randomBytes(32).toString("hex");
  const scheme = tls ? "hive+tls" : "hive+tcp";
  process.stdout.write(scheme + "://" + host + ":" + port + "/" + pairId + "?token=" + token + "\n");
}

async function relayCommand(args: string[]): Promise<void> {
  let host = "127.0.0.1";
  let port = 47821;
  let tlsCertPath: string | undefined;
  let tlsKeyPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--host" && option !== "--port" && option !== "--tls-cert" && option !== "--tls-key") {
      throw new Error("Unknown relay option: " + option);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(option + " requires a value");
    index += 1;
    if (option === "--host") host = value;
    else if (option === "--port") port = Number(value);
    else if (option === "--tls-cert") tlsCertPath = value;
    else tlsKeyPath = value;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be from 1 to 65535");
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) throw new Error("--tls-cert and --tls-key must be provided together");
  await runTcpRelayServer({
    host,
    port,
    ...(tlsCertPath ? { tlsCertPath } : {}),
    ...(tlsKeyPath ? { tlsKeyPath } : {}),
  });
}

function archiveTargetLabel(target: string): string {
  const relay = parseHiveRelayTarget(target);
  return relay
    ? (relay.tls ? "hive+tls://" : "hive+tcp://") + formatRelayHost(relay.host) + ":" + relay.port + "/" + relay.pairId
    : target;
}

function formatRelayHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? "[" + host + "]" : host;
}

async function listCommand(options: ParsedOptions): Promise<void> {
  const [target] = options.positional;
  if (!target || options.positional.length !== 1) {
    throw new Error("Usage: hive list <ssh-target-or-relay-uri> [--cwd <remote-path>] [--limit <n>] [--json]");
  }

  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("--limit must be an integer from 1 to 500");
  }

  const api = await CodexAppServerApi.connect(target);
  try {
    const threads = await api.listThreads({
      limit,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(threads, null, 2)}\n`);
    } else {
      printThreads(threads);
    }
  } finally {
    await api.close();
  }
}

async function importCommand(options: ParsedOptions): Promise<void> {
  const [target, threadId] = options.positional;
  if (!target || !threadId || options.positional.length !== 2) {
    throw new Error(
      "Usage: hive import <ssh-target-or-relay-uri> <thread-id> [--cwd <remote-path>] [--out-dir <local-path>]",
    );
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) {
    throw new Error("Thread ID contains unsupported characters");
  }

  const api = await CodexAppServerApi.connect(target);
  try {
    const threadRead = await api.readThread(threadId);
    const thread = asObject(threadRead.thread);
    const threadCwd = thread && typeof thread.cwd === "string" ? thread.cwd : undefined;
    const remoteCwd = threadCwd ?? options.cwd ?? null;

    const archive: ImportedCodexArchive = {
      format: "hive-codex-archive/v1",
      provider: "codex",
      importedAt: new Date().toISOString(),
      source: { sshTarget: archiveTargetLabel(target), threadId, cwd: remoteCwd },
      threadRead,
    };

    const filePath = await saveArchive(archive, options.outDir ?? defaultArchiveDirectory());
    process.stdout.write(`Imported Codex session ${threadId}\nSaved transcript: ${filePath}\n`);
    process.stdout.write(
      "The live Codex session remains on the source computer; this file is a local history archive and source reference.\n",
    );
  } finally {
    await api.close();
  }
}

async function resumeCommand(options: ParsedOptions): Promise<void> {
  const [target, threadId] = options.positional;
  if (!target || !threadId || options.positional.length !== 2) {
    throw new Error("Usage: hive resume <ssh-target-or-relay-uri> <thread-id>");
  }
  if (options.json || options.cwd || options.limit !== undefined || options.outDir) {
    throw new Error("The resume command does not accept options");
  }

  await resumeCodexThread(target, threadId);
}

function parseOptions(args: string[]): ParsedOptions {
  const result: ParsedOptions = { json: false, positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) throw new Error("Invalid command line arguments");
    if (argument === "--json") {
      result.json = true;
      continue;
    }
    if (argument === "--cwd" || argument === "--out-dir" || argument === "--limit") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--cwd") result.cwd = value;
      else if (argument === "--out-dir") result.outDir = value;
      else {
        const parsedLimit = Number(value);
        if (!Number.isInteger(parsedLimit)) throw new Error("--limit must be an integer");
        result.limit = parsedLimit;
      }
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    result.positional.push(argument);
  }
  return result;
}

function printThreads(threads: CodexThread[]): void {
  if (threads.length === 0) {
    process.stdout.write("No Codex sessions found on that host.\n");
    return;
  }

  for (const thread of threads) {
    const id = typeof thread.id === "string" ? thread.id : "(missing id)";
    const title = firstString(thread.title, thread.name, thread.preview) ?? "Untitled session";
    const cwd = typeof thread.cwd === "string" ? thread.cwd : "(cwd unavailable)";
    const updated = formatDate(thread.updatedAt);
    process.stdout.write(`${id}\t${updated}\t${title}\n  ${cwd}\n`);
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      "Hive Codex Bridge — access Codex CLI sessions over SSH or a TCP relay",
      "",
      "Usage:",
      "  hive list <ssh-target-or-relay-uri> [--cwd <remote-path>] [--limit <1..500>] [--json]",
      "  hive import <ssh-target-or-relay-uri> <thread-id> [--cwd <remote-path>] [--out-dir <local-path>]",
      "  hive resume <ssh-target-or-relay-uri> <thread-id>",
      "  hive relay [--host <address>] [--port <port>] [--tls-cert <pem>] [--tls-key <pem>]",
      "  hive daemon <hive+tcp-or-tls-relay-target>",
      "  hive daemon --mobile [--public-url <wss-url>]",
      "  hive pair <relay-host> [--port <port>] [--tls]",
      "",
      "Inside a resumed session: /skills [filter], /skill:<name> [request], /help, /quit",
      "",
      "Examples:",
      "  hive list devbox --cwd /srv/work/app",
      "  hive import devbox 019abcde-1234-7000-8000-123456789abc --cwd /srv/work/app",
      "  hive resume devbox 019abcde-1234-7000-8000-123456789abc",
      "  hive daemon 'hive+tcp://relay.example:47821/<pair-id>?token=<secret>'",
      "  hive daemon --mobile  # host the Android WSS endpoint",
      "  hive daemon --mobile --public-url wss://203.0.113.10:4753/rpc",
      "",
      `Default archive directory: ${defaultArchiveDirectory()}`,
      "Requires SSH access in SSH mode, or a Hive relay plus the host daemon in relay mode.",
      "Codex CLI must be installed and authenticated on the Codex host.",
    ].join("\n") + "\n",
  );
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown date" : date.toISOString();
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`hive: ${message}\n`);
  process.exitCode = 1;
});
