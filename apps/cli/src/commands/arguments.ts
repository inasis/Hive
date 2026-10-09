export type ParsedOptions = {
  cwd?: string;
  limit?: number;
  json: boolean;
  outDir?: string;
  positional: string[];
};

export function parseDaemonOptions(args: string[]): string | undefined {
  let publicUrl: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    // Existing daemon supervisors retain their original arguments when they restart.
    if (option === "--mobile") continue;
    if (option !== "--public-url") throw new Error("Unknown daemon option: " + option);
    if (publicUrl) throw new Error("--public-url can only be provided once");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--public-url requires a wss:// URL ending in /rpc");
    publicUrl = value;
    index += 1;
  }
  return publicUrl;
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
