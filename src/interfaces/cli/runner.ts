import type { CodexCliThreadRecord } from "../../application/ports/codex-cli.js";

type ParsedOptions = {
  cwd?: string;
  limit?: number;
  json: boolean;
  outDir?: string;
  positional: string[];
};

export type RelayCommandOptions = {
  host: string;
  port: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
};

export type CliRuntime = {
  defaultArchiveDirectory(): string;
  isRelayTarget(target: string): boolean;
  listCodexThreads(target: string, options: { cwd?: string; limit: number }): Promise<CodexCliThreadRecord[]>;
  importCodexThread(target: string, threadId: string, options: { cwd?: string; outDir?: string }): Promise<string>;
  resumeCodexThread(target: string, threadId: string): Promise<void>;
  runRelay(options: RelayCommandOptions): Promise<void>;
  runDaemon(target: string): Promise<void>;
  runMobileDaemon(publicUrl?: string): Promise<void>;
  createPairingUri(host: string, port: number, tls: boolean): string;
  writeStdout(text: string): void;
};

/** Parse user commands, invoke application workflows, and format terminal output. */
export async function runCli(args: string[], runtime: CliRuntime): Promise<void> {
  const [command, ...commandArgs] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    runtime.writeStdout(printHelp(runtime.defaultArchiveDirectory()));
    return;
  }

  if (command === "relay") {
    await runtime.runRelay(parseRelayOptions(commandArgs));
    return;
  }
  if (command === "daemon") {
    if (commandArgs[0] === "--mobile") {
      await runtime.runMobileDaemon(parseMobileDaemonOptions(commandArgs.slice(1)));
      return;
    }
    const [target] = commandArgs;
    if (!target || commandArgs.length !== 1 || !runtime.isRelayTarget(target)) {
      throw new Error("Usage: hive daemon <hive+tcp-or-tls-relay-target> | daemon --mobile [--public-url <wss-url>]");
    }
    await runtime.runDaemon(target);
    return;
  }
  if (command === "pair") {
    const pair = parsePairOptions(commandArgs);
    runtime.writeStdout(runtime.createPairingUri(pair.host, pair.port, pair.tls) + "\n");
    return;
  }

  const options = parseOptions(commandArgs);
  if (command === "list") {
    const [target] = options.positional;
    if (!target || options.positional.length !== 1) {
      throw new Error("Usage: hive list <ssh-target-or-relay-uri> [--cwd <remote-path>] [--limit <n>] [--json]");
    }
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("--limit must be an integer from 1 to 500");
    }
    const threads = await runtime.listCodexThreads(target, {
      limit,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    runtime.writeStdout(options.json ? `${JSON.stringify(threads, null, 2)}\n` : printThreads(threads));
    return;
  }
  if (command === "import") {
    const [target, threadId] = options.positional;
    if (!target || !threadId || options.positional.length !== 2) {
      throw new Error(
        "Usage: hive import <ssh-target-or-relay-uri> <thread-id> [--cwd <remote-path>] [--out-dir <local-path>]",
      );
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) {
      throw new Error("Thread ID contains unsupported characters");
    }
    const filePath = await runtime.importCodexThread(target, threadId, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.outDir ? { outDir: options.outDir } : {}),
    });
    runtime.writeStdout(`Imported Codex session ${threadId}\nSaved transcript: ${filePath}\n`);
    runtime.writeStdout(
      "The live Codex session remains on the source computer; this file is a local history archive and source reference.\n",
    );
    return;
  }
  if (command === "resume") {
    const [target, threadId] = options.positional;
    if (!target || !threadId || options.positional.length !== 2) {
      throw new Error("Usage: hive resume <ssh-target-or-relay-uri> <thread-id>");
    }
    if (options.json || options.cwd || options.limit !== undefined || options.outDir) {
      throw new Error("The resume command does not accept options");
    }
    await runtime.resumeCodexThread(target, threadId);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseMobileDaemonOptions(args: string[]): string | undefined {
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
  return publicUrl;
}

function parsePairOptions(args: string[]): { host: string; port: number; tls: boolean } {
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
  return { host, port, tls };
}

function parseRelayOptions(args: string[]): RelayCommandOptions {
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
  return {
    host,
    port,
    ...(tlsCertPath ? { tlsCertPath } : {}),
    ...(tlsKeyPath ? { tlsKeyPath } : {}),
  };
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

function printThreads(threads: CodexCliThreadRecord[]): string {
  if (threads.length === 0) return "No Codex sessions found on that host.\n";
  return threads.map((thread) => {
    const id = thread.id;
    const title = firstString(thread.title, thread.name, thread.preview) ?? "Untitled session";
    const cwd = typeof thread.cwd === "string" ? thread.cwd : "(cwd unavailable)";
    return `${id}\t${formatDate(thread.updatedAt)}\t${title}\n  ${cwd}\n`;
  }).join("");
}

function printHelp(defaultArchiveDirectory: string): string {
  return [
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
    `Default archive directory: ${defaultArchiveDirectory}`,
    "Requires SSH access in SSH mode, or a Hive relay plus the host daemon in relay mode.",
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
