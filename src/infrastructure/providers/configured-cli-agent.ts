import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { stat } from "node:fs/promises";
import type { AdapterCapabilities } from "../../domain/a2a-adapter.js";
import type {
  A2AAgentInputDto as AgentInput,
  A2ATaskDto as AgentTask,
  A2ATaskResultDto as AgentResult,
} from "../../application/dto/a2a-collaboration.js";
import type { A2AIntegrationStatusDto, NativeSession, PersistenceLevel } from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapter, AgentExecutionContext } from "../../application/ports/a2a-agent-adapter.js";
import { validateProfile, materializeArgs, type ConfiguredCliAgentProfile, type ConfiguredCliSession } from "./configured-cli-agent-profile.js";
import { formatPrompt, mapCommandResult } from "./configured-cli-agent-output.js";
import { resolveExecutable, runProcess, runCancellationCommand, stopChild } from "./configured-cli-agent-process.js";
import { adapterFault } from "./configured-cli-agent-errors.js";

type ActiveInvocation = {
  session: ConfiguredCliSession;
  child?: ChildProcessWithoutNullStreams;
};

/** Explicitly configured subprocess adapter for documented provider CLIs and custom agents. */
export class ConfiguredCliAgentAdapter implements AgentAdapter {
  readonly adapterId: string;
  readonly provider: string;
  readonly integrationStatus: A2AIntegrationStatusDto;
  readonly evidence: AgentAdapter["evidence"];
  readonly capabilities: Readonly<AdapterCapabilities>;

  private readonly sessions: readonly ConfiguredCliSession[];
  private readonly active = new Map<string, ActiveInvocation>();

  constructor(private readonly profile: ConfiguredCliAgentProfile) {
    validateProfile(profile);
    this.adapterId = profile.adapterId;
    this.provider = profile.provider;
    this.integrationStatus = profile.integrationStatus;
    this.evidence = Object.freeze({ ...profile.evidence, limitations: [...profile.evidence.limitations] });
    this.sessions = profile.sessions.map((session) => ({ ...session }));
    this.capabilities = Object.freeze({
      discoverSessions: this.sessions.length > 0,
      attachExistingProcess: false,
      resumeSession: profile.resumeArgs !== undefined,
      persistentContext: this.sessions.some((session) => session.persistenceLevel > 0),
      structuredOutput: profile.outputFormat !== "text",
      streaming: false,
      cancellation: profile.cancellation !== undefined,
      toolCalling: profile.capabilities.toolCalling,
      fileAccess: profile.capabilities.fileAccess,
      shellAccess: profile.capabilities.shellAccess,
      delegation: profile.delegation !== undefined,
      concurrentTasks: false,
    });
  }

  async discoverSessions(): Promise<NativeSession[]> {
    return this.sessions.map((session) => ({ ...session, provider: this.provider }));
  }

  async isAvailable(session: NativeSession): Promise<boolean> {
    const configured = this.sessions.find((candidate) => candidate.sessionId === session.sessionId);
    if (!configured || session.provider !== this.provider || configured.persistenceLevel !== session.persistenceLevel ||
        configured.runtimeManagedHistory !== session.runtimeManagedHistory || configured.workspace !== session.workspace) return false;
    if (!await resolveExecutable(this.profile.command)) return false;
    if (session.workspace) {
      try { if (!(await stat(session.workspace)).isDirectory()) return false; } catch { return false; }
    }
    return true;
  }

  async execute(session: NativeSession, task: AgentTask, context: AgentExecutionContext): Promise<AgentResult> {
    const configured = this.requireSession(session, 0, 1);
    return this.invoke(configured, task, context, this.profile.args);
  }

  async resume(session: NativeSession, input: AgentInput, context: AgentExecutionContext): Promise<AgentResult> {
    const configured = this.requireSession(session, 2);
    if (!this.profile.resumeArgs) {
      throw adapterFault("RESUME_UNSUPPORTED", this.provider, "No native resume command is configured for this adapter");
    }
    return this.invoke(configured, input.task, context, this.profile.resumeArgs);
  }

  async cancel(session: NativeSession, taskId: string): Promise<void> {
    const invocation = this.active.get(taskId);
    if (!invocation) return;
    if (!invocation.child) return;
    if (!this.profile.cancellation) {
      throw adapterFault("CANCEL_UNSUPPORTED", this.provider, "No provider cancellation command is configured");
    }
    const executable = this.profile.cancellation.command ?? this.profile.command;
    const args = materializeArgs(this.profile.cancellation.args, invocation.session, taskId);
    try {
      await runCancellationCommand(executable, args, invocation.session.workspace, this.profile.environment);
    } finally {
      stopChild(invocation.child);
    }
  }

  private requireSession(session: NativeSession, ...levels: PersistenceLevel[]): ConfiguredCliSession {
    const configured = this.sessions.find((candidate) => candidate.sessionId === session.sessionId);
    if (!configured || session.provider !== this.provider || !levels.includes(session.persistenceLevel)) {
      throw adapterFault("SESSION_NOT_FOUND", this.provider, "The configured native session does not match this adapter profile");
    }
    if (configured.persistenceLevel !== session.persistenceLevel || configured.workspace !== session.workspace) {
      throw adapterFault("SESSION_NOT_FOUND", this.provider, "The native session descriptor changed after registration");
    }
    return configured;
  }

  private async invoke(
    session: ConfiguredCliSession,
    task: AgentTask,
    context: AgentExecutionContext,
    configuredArgs: string[],
  ): Promise<AgentResult> {
    if (this.active.has(task.taskId)) throw adapterFault("INVALID_REQUEST", this.provider, "A2A task ID is already active");
    const invocation: ActiveInvocation = { session };
    this.active.set(task.taskId, invocation);
    const artifacts: NonNullable<AgentResult["artifacts"]> = [];
    const executable = await resolveExecutable(this.profile.command);
    if (!executable) {
      this.active.delete(task.taskId);
      throw adapterFault("PROVIDER_NOT_INSTALLED", this.provider, "Configured agent executable was not found");
    }

    try {
      const args = materializeArgs(configuredArgs, session, task.taskId);
      const prompt = formatPrompt(task, task.message, this.profile.delegation ? this.profile : undefined);
      if (this.profile.promptDelivery === "argument") args.push(prompt);
      const { code, stdout, stderr } = await runProcess({
        command: executable,
        args,
        ...(session.workspace ? { cwd: session.workspace } : {}),
        ...(this.profile.environment ? { environment: this.profile.environment } : {}),
        ...(this.profile.promptDelivery === "stdin" ? { input: this.profile.stdinFormat === "json"
          ? JSON.stringify({ task, message: prompt, history: [] })
          : prompt } : {}),
        signal: context.signal,
        stopOnAbort: this.profile.cancellation === undefined,
        maxOutputBytes: this.profile.maxOutputBytes ?? 8 * 1024 * 1024,
        onSpawn: (child) => { invocation.child = child; },
      });
      delete invocation.child;
      if (code !== 0) {
        return {
          taskId: task.taskId,
          agentId: task.targetAgent,
          status: "FAILED",
          message: stderr.trim() || stdout.trim() || `Agent process exited with status ${code ?? "unknown"}.`,
          metadata: { exitCode: code },
        };
      }
      const output = mapCommandResult(this.profile, stdout, task);
      artifacts.push(...(output.result.artifacts ?? []));
      if (!output.delegations.length) return { ...output.result, ...(artifacts.length ? { artifacts } : {}) };
      if (!this.profile.delegation) {
        throw adapterFault("OUTPUT_PARSE_FAILED", this.provider, "Agent requested delegation without an enabled A2A delegation profile");
      }
      if (output.delegations.length > this.profile.delegation.maxCallsPerTask) {
        throw adapterFault("MAX_DEPTH_EXCEEDED", this.provider, "Agent exceeded the configured delegation call limit");
      }
      for (const request of output.delegations) await context.delegate(request);
      return { ...output.result, ...(artifacts.length ? { artifacts } : {}) };
    } finally {
      this.active.delete(task.taskId);
    }
  }
}
