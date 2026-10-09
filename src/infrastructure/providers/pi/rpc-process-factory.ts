import type { JsonObject } from "./session-types.js";
import { PiRpcProcess } from "./rpc-process.js";

const PI_MODEL_PROVIDER = "hive";
const PI_TASK_EXECUTION_POLICY = [
  "You are operating as an autonomous task agent in Hive.",
  "For requests that ask you to investigate, create, change, fix, or deliver something, carry the task through to its requested result. Do not stop after an explanation, plan, diagnosis, partial implementation, or first attempt.",
  "Use the available tools to inspect the real workspace, make changes within the requested scope, and verify the result. After each action, inspect what happened; when a check fails, fix the cause and repeat the inspect, act, and verify loop until the requested outcome is achieved.",
  "Before finishing, compare the result against every concrete part of the request. Report only work and checks you actually completed.",
  "Stop and explain only when a required decision or permission is missing, a necessary resource is unavailable, or further action would exceed the request. Follow repository instructions, user constraints, and the permissions of your tools.",
  "For direct questions or requests for ideas rather than a deliverable, answer directly without inventing extra work.",
].join("\n");

export type PiRpcProcessLaunchOptions = {
  command: string;
  sessionDirectory: string;
  cwd: string;
  sessionFile?: string;
  onRecord?: (record: JsonObject) => void;
  initialModel?: string;
  noSession?: boolean;
  providerId?: string;
  a2aExtensionPath?: string;
  callerAgentId?: string;
};

/** Builds the Pi CLI invocation while the RPC client owns process I/O and JSONL behavior. */
export function createPiRpcProcess(options: PiRpcProcessLaunchOptions): PiRpcProcess {
  const args = ["--mode", "rpc", "--session-dir", options.sessionDirectory];
  args.push("--append-system-prompt", PI_TASK_EXECUTION_POLICY);
  if (options.noSession) args.push("--no-session");
  if (options.sessionFile) args.push("--session", options.sessionFile);
  const selectedProvider = options.providerId ?? (options.initialModel ? PI_MODEL_PROVIDER : undefined);
  if (selectedProvider) args.push("--provider", selectedProvider);
  if (options.initialModel) args.push("--model", options.initialModel);
  if (options.a2aExtensionPath) args.push("--extension", options.a2aExtensionPath);
  const callerAgentId = options.callerAgentId?.trim();
  const env = callerAgentId
    ? { ...process.env, HIVE_PI_CALLER_AGENT_ID: callerAgentId }
    : undefined;
  return new PiRpcProcess({
    command: options.command,
    args,
    cwd: options.cwd,
    ...(env ? { env } : {}),
    ...(options.onRecord ? { onRecord: options.onRecord } : {}),
  });
}
