import { asObject, firstString, type JsonObject } from "./session-utils.js";

export type KiroTerminalCommandOptions = {
  command: string;
  args: string[];
  env: Record<string, string>;
  requestedCwd: string;
};

export function parseKiroTerminalCommandOptions(params: JsonObject, workspace: string): KiroTerminalCommandOptions {
  const command = firstString(params.command);
  if (!command || command.length > 4_096 || command.includes("\0")) throw new Error("Kiro ACP terminal command is invalid");
  const argsValue = params.args;
  if (argsValue !== undefined && (!Array.isArray(argsValue) || argsValue.length > 256 || argsValue.some((arg) => typeof arg !== "string" || arg.length > 16_384 || arg.includes("\0")))) {
    throw new Error("Kiro ACP terminal arguments are invalid");
  }
  const args = (Array.isArray(argsValue) ? argsValue : []) as string[];
  const envValue = params.env;
  if (envValue !== undefined && (!Array.isArray(envValue) || envValue.length > 128)) throw new Error("Kiro ACP terminal environment is invalid");
  const env: Record<string, string> = {};
  for (const itemValue of Array.isArray(envValue) ? envValue : []) {
    const item = asObject(itemValue);
    const name = firstString(item?.name);
    const value = typeof item?.value === "string" ? item.value : undefined;
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value === undefined || value.includes("\0")) throw new Error("Kiro ACP terminal environment contains an invalid variable");
    env[name] = value;
  }
  return { command, args, env, requestedCwd: firstString(params.cwd) ?? workspace };
}

export function parseKiroTerminalOutputByteLimit(value: unknown): number {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) throw new Error("Kiro ACP terminal output limit is invalid");
  return Math.min(4 * 1024 * 1024, value === undefined ? 1024 * 1024 : value as number);
}
