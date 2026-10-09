import type { AgentAdapter } from "../../application/ports/a2a-agent-adapter.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type AssistantRuntimeOptions = {
  /** Existing Hive provider targets allowed to participate in A2A discovery. */
  a2aTargets?: Partial<Record<AssistantProvider, readonly string[]>>;
  /** Optional private JSON state file for A2A rooms, tasks, and session mappings. */
  a2aStateFilePath?: string;
  /** Optional private JSON file that stores stable UUIDs and names for provider sessions visible to Hive. */
  sessionIdentityFilePath?: string;
  /** Optional declarative profile file for external CLI and custom agents. */
  a2aCliProfilesFilePath?: string;
  /** Additional explicit CLI/API/PTY adapters supplied by the host. */
  a2aAdapters?: readonly AgentAdapter[];
};
