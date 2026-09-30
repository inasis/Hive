import { readFileSync } from "node:fs";
import { ConfiguredCliAgentAdapter, type ConfiguredCliAgentProfile } from "../providers/configured-cli-agent.js";

const MAX_PROFILE_FILE_BYTES = 1024 * 1024;

/** Load explicit, declarative CLI adapter profiles. Commands remain argv-based and never use a shell. */
export function loadA2ACliProfiles(filePath: string): ConfiguredCliAgentAdapter[] {
  if (!filePath.trim()) throw new Error("A2A CLI profile path must not be empty");
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    throw new Error("Could not read A2A CLI profile file");
  }
  if (Buffer.byteLength(contents, "utf8") > MAX_PROFILE_FILE_BYTES) throw new Error("A2A CLI profile file exceeds the size limit");
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("A2A CLI profile file is not valid JSON");
  }
  if (!Array.isArray(value)) throw new Error("A2A CLI profile file must contain a JSON array");
  try {
    return value.map((profile) => new ConfiguredCliAgentAdapter(profile as ConfiguredCliAgentProfile));
  } catch {
    throw new Error("A2A CLI profile file contains an invalid adapter profile");
  }
}
