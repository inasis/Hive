export type ParsedOptions = {
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

export function parseMobileDaemonOptions(args: string[]): string | undefined {
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

export function parsePairOptions(args: string[]): { host: string; port: number; tls: boolean } {
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

export function parseRelayOptions(args: string[]): RelayCommandOptions {
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

export function parseSessionOptions(args: string[]): ParsedOptions {
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
