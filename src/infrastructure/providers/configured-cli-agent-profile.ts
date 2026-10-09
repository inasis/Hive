import type { AdapterCapabilities } from "../../domain/a2a-adapter.js";
import type { A2AIntegrationStatusDto, PersistenceLevel } from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapter } from "../../application/ports/a2a-agent-adapter.js";

export type ConfiguredCliSession = {
  sessionId: string;
  sessionName?: string;
  workspace?: string;
  persistenceLevel: PersistenceLevel;
  runtimeManagedHistory: boolean;
};

export type ConfiguredCliAgentProfile = {
  adapterId: string;
  provider: string;
  command: string;
  args: string[];
  resumeArgs?: string[];
  sessions: ConfiguredCliSession[];
  promptDelivery: "stdin" | "argument";
  stdinFormat?: "text" | "json";
  outputFormat: "text" | "json" | "ndjson";
  ndjsonResultEvent?: { eventField: string; eventName: string; textField: string };
  /** Enables a JSON result protocol that calls back into the A2A runtime. */
  delegation?: { maxCallsPerTask: number };
  cancellation?: { command?: string; args: string[] };
  capabilities: Pick<AdapterCapabilities, "toolCalling" | "fileAccess" | "shellAccess">;
  integrationStatus: A2AIntegrationStatusDto;
  evidence: AgentAdapter["evidence"];
  environment?: Record<string, string>;
  maxOutputBytes?: number;
};

export function validateProfile(profile: ConfiguredCliAgentProfile): void {
  for (const [name, value] of [["adapterId", profile.adapterId], ["provider", profile.provider], ["command", profile.command]] as const) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`Configured CLI ${name} must be non-empty`);
  }
  if (!Array.isArray(profile.args) || profile.args.some((argument) => typeof argument !== "string")) throw new Error("Configured CLI args must be strings");
  if (profile.resumeArgs !== undefined && (!Array.isArray(profile.resumeArgs) || profile.resumeArgs.some((argument) => typeof argument !== "string"))) {
    throw new Error("Configured CLI resumeArgs must be strings");
  }
  if (!Array.isArray(profile.sessions)) throw new Error("Configured CLI sessions must be an array");
  const sessionIds = new Set<string>();
  for (const session of profile.sessions) {
    if (!session.sessionId.trim() || sessionIds.has(session.sessionId)) throw new Error("Configured CLI session IDs must be unique and non-empty");
    sessionIds.add(session.sessionId);
    if (session.sessionName !== undefined && !session.sessionName.trim()) throw new Error("Configured CLI session names must be non-empty when specified");
    if (session.workspace !== undefined && !session.workspace.trim()) throw new Error("Configured CLI workspace must be non-empty when specified");
    if (session.persistenceLevel !== 0 && session.persistenceLevel !== 1 && session.persistenceLevel !== 2) {
      throw new Error("Configured CLI sessions support persistence levels 0, 1, and 2");
    }
    if (session.persistenceLevel === 1 && !session.runtimeManagedHistory) throw new Error("Persistence level 1 requires runtime-managed history");
    if (session.persistenceLevel !== 1 && session.runtimeManagedHistory) throw new Error("Runtime-managed history is only valid at persistence level 1");
    if (session.persistenceLevel === 2 && profile.resumeArgs === undefined) throw new Error("Level 2 sessions require explicit resumeArgs");
  }
  if (profile.promptDelivery !== "stdin" && profile.promptDelivery !== "argument") throw new Error("Configured CLI promptDelivery must be stdin or argument");
  if (profile.stdinFormat !== undefined && profile.stdinFormat !== "text" && profile.stdinFormat !== "json") throw new Error("Configured CLI stdinFormat is invalid");
  if (profile.outputFormat !== "text" && profile.outputFormat !== "json" && profile.outputFormat !== "ndjson") {
    throw new Error("Configured CLI outputFormat must be text, json, or ndjson");
  }
  if (profile.outputFormat === "ndjson" && (!profile.ndjsonResultEvent ||
      !profile.ndjsonResultEvent.eventField.trim() || !profile.ndjsonResultEvent.eventName.trim() || !profile.ndjsonResultEvent.textField.trim())) {
    throw new Error("NDJSON output requires an explicit result event field, event name, and text field");
  }
  if (profile.delegation && (profile.outputFormat === "text" || !Number.isSafeInteger(profile.delegation.maxCallsPerTask) ||
      profile.delegation.maxCallsPerTask < 1 || profile.delegation.maxCallsPerTask > 8 ||
      !profile.sessions.length)) {
    throw new Error("Delegation requires structured output, at least one session, and a limit from 1 to 8 calls");
  }
  if (profile.cancellation && (!Array.isArray(profile.cancellation.args) || profile.cancellation.args.some((arg) => typeof arg !== "string"))) {
    throw new Error("Configured CLI cancellation args must be strings");
  }
  if (profile.cancellation?.command !== undefined && !profile.cancellation.command.trim()) {
    throw new Error("Configured CLI cancellation command must be non-empty");
  }
  if (!profile.capabilities || typeof profile.capabilities.toolCalling !== "boolean" ||
      typeof profile.capabilities.fileAccess !== "boolean" || typeof profile.capabilities.shellAccess !== "boolean") {
    throw new Error("Configured CLI tool/file/shell capabilities must be explicit booleans");
  }
  if (profile.evidence.source === "unsupported" && profile.integrationStatus !== "UNAVAILABLE" &&
      profile.integrationStatus !== "MANUAL_CONFIGURATION_REQUIRED") throw new Error("Unsupported evidence cannot be marked routable");
  if (profile.evidence.confidence === "low" && profile.integrationStatus === "VERIFIED") throw new Error("Low-confidence evidence cannot be verified");
  if (profile.environment && Object.values(profile.environment).some((value) => typeof value !== "string")) {
    throw new Error("Configured CLI environment values must be strings");
  }
  if (profile.maxOutputBytes !== undefined && (!Number.isSafeInteger(profile.maxOutputBytes) || profile.maxOutputBytes < 1)) {
    throw new Error("Configured CLI maxOutputBytes must be a positive integer");
  }
}

export function materializeArgs(args: string[], session: ConfiguredCliSession, taskId: string): string[] {
  return args.map((argument) => argument
    .replaceAll("{sessionId}", session.sessionId)
    .replaceAll("{workspace}", session.workspace ?? "")
    .replaceAll("{taskId}", taskId));
}
