import type { AgentAdapter, AgentExecutionContext } from "../../application/ports/a2a-runtime.js";
import type { AgentInput, AgentResult, AgentTask, NativeSession } from "../../domain/a2a.js";

/** Visible registry entry for a provider that needs an explicit, verified adapter profile. */
export class ManualConfigurationAgentAdapter implements AgentAdapter {
  readonly integrationStatus = "MANUAL_CONFIGURATION_REQUIRED" as const;
  readonly capabilities = Object.freeze({
    discoverSessions: false,
    attachExistingProcess: false,
    resumeSession: false,
    persistentContext: false,
    structuredOutput: false,
    streaming: false,
    cancellation: false,
    toolCalling: false,
    fileAccess: false,
    shellAccess: false,
    delegation: false,
    concurrentTasks: false,
  });
  readonly evidence = Object.freeze({
    source: "unsupported" as const,
    verifiedAt: "2026-09-29",
    confidence: "low" as const,
    limitations: ["No provider transport profile is configured; session discovery and execution are disabled."],
  });

  constructor(readonly adapterId: string, readonly provider: string) {
    if (!adapterId.trim() || !provider.trim()) throw new Error("Manual adapter identity must be non-empty");
  }

  async discoverSessions(): Promise<NativeSession[]> { return []; }
  async isAvailable(_session: NativeSession): Promise<boolean> { return false; }
  async execute(_session: NativeSession, task: AgentTask, _context: AgentExecutionContext): Promise<AgentResult> {
    return this.unavailable(task.taskId, task.targetAgent);
  }
  async resume(_session: NativeSession, input: AgentInput, _context: AgentExecutionContext): Promise<AgentResult> {
    return this.unavailable(input.task.taskId, input.task.targetAgent);
  }
  async cancel(_session: NativeSession, _taskId: string): Promise<void> {}

  private unavailable(taskId: string, agentId: string): AgentResult {
    return {
      taskId,
      agentId,
      status: "FAILED",
      message: "Provider adapter requires an explicit verified profile.",
      metadata: { adapterErrorCode: "UNVERIFIED_INTEGRATION" },
    };
  }
}
