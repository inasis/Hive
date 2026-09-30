import { access, constants, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AdapterCapabilities, AgentInput, AgentResult, AgentTask, NativeSession, PersistenceLevel } from "../../domain/a2a.js";
import type { AgentAdapter, AgentExecutionContext, IntegrationStatus } from "../../application/ports/a2a-runtime.js";

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
  integrationStatus: IntegrationStatus;
  evidence: AgentAdapter["evidence"];
  environment?: Record<string, string>;
  maxOutputBytes?: number;
};

type ActiveInvocation = {
  session: ConfiguredCliSession;
  child?: ChildProcessWithoutNullStreams;
};

type AgentDelegationRequest = {
  interaction?: "A2A" | "A2B";
  targetAgent?: string;
  targetSessionName?: string;
  selector?: { role?: string; capabilities?: string[]; workspace?: string; provider?: string };
  message: string;
  timeoutMs?: number;
  responseForTaskId?: string;
  callbackForTaskId?: string;
};

/** Explicitly configured subprocess adapter for documented provider CLIs and custom agents. */
export class ConfiguredCliAgentAdapter implements AgentAdapter {
  readonly adapterId: string;
  readonly provider: string;
  readonly integrationStatus: IntegrationStatus;
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

function validateProfile(profile: ConfiguredCliAgentProfile): void {
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

function materializeArgs(args: string[], session: ConfiguredCliSession, taskId: string): string[] {
  return args.map((argument) => argument
    .replaceAll("{sessionId}", session.sessionId)
    .replaceAll("{workspace}", session.workspace ?? "")
    .replaceAll("{taskId}", taskId));
}

function formatPrompt(
  task: AgentTask,
  message: string,
  delegationProfile?: ConfiguredCliAgentProfile,
): string {
  const delegationInstruction = delegationProfile?.delegation
    ? delegationProfile.outputFormat === "ndjson"
      ? `\n\nEmit a final NDJSON result event where ${delegationProfile.ndjsonResultEvent!.eventField} is ${JSON.stringify(delegationProfile.ndjsonResultEvent!.eventName)} and ${delegationProfile.ndjsonResultEvent!.textField} contains your message. Include an optional delegations array. Each item can include interaction, message, targetSessionName (preferred) and/or targetAgent ID, or a selector; use responseForTaskId or callbackForTaskId to mark a response delivery. Delegations run asynchronously; do not wait for them. Do not delegate when the task can be completed directly.`
      : "\n\nReturn one JSON object with a message field. To send a task or response, add a delegations array with interaction, message, targetSessionName (preferred) and/or targetAgent ID, or a selector; use responseForTaskId or callbackForTaskId to mark a response delivery. Delegations run asynchronously; do not wait for them. Do not delegate when the task can be completed directly."
    : "";
  const delivery = task.metadata?.delivery;
  const taskInstruction = delivery === "a2a-async-request"
    ? `A2A request: deliver your answer in an async delegation with responseForTaskId=${task.taskId} to a chosen existing/new agent, or send it to the original caller with callbackForTaskId=${task.taskId}. Accepted delivery is success; do not wait for the recipient. A local result without delivery is incomplete.`
    : delivery === "a2a-result-delivery"
      ? `A2A response recipient: forward with responseForTaskId=${task.taskId}, return once to your sender with callbackForTaskId=${task.taskId}, or finish. Do not wait for accepted sends.`
      : delivery === "a2a-result-callback"
        ? `A2A callback recipient: forward with responseForTaskId=${task.taskId} or finish. This result was already returned; do not send another callback.`
        : delivery === "a2b-bonded-request"
          ? `Bonded A2B: answer directly as this agent; do not delegate. If the caller must resume, send it a2a_send with callbackForTaskId=${task.taskId}.`
          : undefined;
  return [
    "Handle one Hive A2A task. Use only this request as task context; read workspace files if more context is needed.",
    `Task ID: ${task.taskId}`,
    ...(taskInstruction ? [taskInstruction] : []),
    ...(delegationInstruction ? [delegationInstruction.trim()] : []),
    "",
    "Request:",
    message,
  ].join("\n");
}

function mapCommandResult(
  profile: ConfiguredCliAgentProfile,
  stdout: string,
  task: AgentTask,
): { result: AgentResult; delegations: AgentDelegationRequest[] } {
  if (profile.outputFormat === "text") {
    return { result: { taskId: task.taskId, agentId: task.targetAgent, status: "COMPLETED", message: stdout.trim() }, delegations: [] };
  }
  let value: unknown;
  if (profile.outputFormat === "json") {
    try { value = JSON.parse(stdout); } catch {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent returned invalid JSON output");
    }
  } else {
    const eventConfig = profile.ndjsonResultEvent!;
    const records: unknown[] = [];
    for (const line of stdout.split(/\r?\n/).filter((item) => item.trim())) {
      try { records.push(JSON.parse(line)); } catch {
        throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent returned an invalid NDJSON line");
      }
    }
    const event = [...records].reverse().find((item) => isRecord(item) && item[eventConfig.eventField] === eventConfig.eventName);
    const text = event && isRecord(event) ? readPath(event, eventConfig.textField) : undefined;
    if (typeof text !== "string") throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent NDJSON result event did not contain the configured text field");
    value = {
      message: text,
      ...(event && isRecord(event) ? { artifacts: event.artifacts, delegations: event.delegations ?? event.delegate } : {}),
    };
  }
  if (!isRecord(value) || typeof (value.message ?? value.text) !== "string") {
    throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent JSON output must contain a message or text field");
  }
  const artifacts = value.artifacts;
  if (artifacts !== undefined && (!Array.isArray(artifacts) || artifacts.some((item) => !isRecord(item) || typeof item.name !== "string"))) {
    throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent artifacts must contain names");
  }
  const configuredDelegations = value.delegations;
  const rawDelegations = Array.isArray(configuredDelegations)
    ? configuredDelegations
    : configuredDelegations === undefined
      ? (value.delegate === undefined ? [] : [value.delegate])
      : [configuredDelegations];
  const delegations: AgentDelegationRequest[] = rawDelegations.map((request) => {
    if (!isRecord(request) || typeof request.message !== "string" || !request.message.trim()) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Each configured delegation must contain a message");
    }
    const hasTarget = typeof request.targetAgent === "string" && request.targetAgent.trim().length > 0;
    const hasSessionName = typeof request.targetSessionName === "string" && request.targetSessionName.trim().length > 0;
    const hasSelector = isRecord(request.selector);
    if ((hasTarget || hasSessionName) === hasSelector) throw adapterFault("OUTPUT_PARSE_FAILED", "", "Each delegation must select a session name/agent ID or selector");
    if (hasSessionName && (request.targetSessionName as string).trim().length > 120) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation targetSessionName must be 120 characters or fewer");
    }
    if (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || (request.timeoutMs as number) <= 0)) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation timeoutMs must be a positive integer");
    }
    if (request.interaction !== undefined && request.interaction !== "A2A" && request.interaction !== "A2B") {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation interaction must be A2A or A2B");
    }
    const responseForTaskId = request.responseForTaskId;
    const callbackForTaskId = request.callbackForTaskId;
    if ((responseForTaskId !== undefined && (typeof responseForTaskId !== "string" || !responseForTaskId.trim())) ||
        (callbackForTaskId !== undefined && (typeof callbackForTaskId !== "string" || !callbackForTaskId.trim()))) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation response task IDs must be non-empty strings");
    }
    if (responseForTaskId !== undefined && callbackForTaskId !== undefined) {
      throw adapterFault("OUTPUT_PARSE_FAILED", "", "Delegation cannot set both responseForTaskId and callbackForTaskId");
    }
    return {
      ...(request.interaction ? { interaction: request.interaction } : {}),
      ...(hasTarget ? { targetAgent: request.targetAgent as string } : {}),
      ...(hasSessionName ? { targetSessionName: request.targetSessionName as string } : {}),
      ...(hasSelector ? { selector: request.selector as NonNullable<AgentDelegationRequest["selector"]> } : {}),
      message: request.message,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs as number }),
      ...(typeof responseForTaskId === "string" ? { responseForTaskId } : {}),
      ...(typeof callbackForTaskId === "string" ? { callbackForTaskId } : {}),
    };
  });
  return {
    result: {
      taskId: task.taskId,
      agentId: task.targetAgent,
      status: "COMPLETED",
      message: (value.message ?? value.text) as string,
      ...(Array.isArray(artifacts) ? { artifacts: artifacts as NonNullable<AgentResult["artifacts"]> } : {}),
    },
    delegations,
  };
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

async function resolveExecutable(command: string): Promise<string | undefined> {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    try { await access(command, constants.X_OK); return command; } catch { return undefined; }
  }
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, process.platform === "win32" ? `${command}${extension}` : command);
      try { await access(candidate, constants.X_OK); return candidate; } catch { /* try the next PATH entry */ }
    }
  }
  return undefined;
}

async function runProcess(input: {
  command: string;
  args: string[];
  cwd?: string;
  environment?: Record<string, string>;
  input?: string;
  signal: AbortSignal;
  stopOnAbort: boolean;
  maxOutputBytes: number;
  onSpawn(child: ChildProcessWithoutNullStreams): void;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  if (input.signal.aborted) throw adapterFault("PROCESS_EXITED", "", "Agent task was cancelled before process start");
  if (input.cwd) {
    try { if (!(await stat(input.cwd)).isDirectory()) throw new Error("not a directory"); }
    catch { throw adapterFault("WORKSPACE_NOT_FOUND", "", "Configured agent workspace is unavailable"); }
  }
  const child = spawn(input.command, input.args, {
    ...(input.cwd ? { cwd: input.cwd } : {}),
    env: { ...process.env, ...input.environment },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  input.onSpawn(child);
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes > input.maxOutputBytes) {
      stopChild(child);
      return;
    }
    if (target === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  const abort = (): void => { if (input.stopOnAbort) stopChild(child); };
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.input !== undefined) child.stdin.end(input.input);
  else child.stdin.end();
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode) => resolve(exitCode));
    });
    if (outputBytes > input.maxOutputBytes) throw adapterFault("OUTPUT_PARSE_FAILED", "", "Configured agent output exceeded its size limit");
    if (input.signal.aborted) throw adapterFault("PROCESS_EXITED", "", "Agent task was cancelled");
    return { code, stdout, stderr };
  } catch (error) {
    if (input.signal.aborted) throw adapterFault("PROCESS_EXITED", "", "Agent task was cancelled");
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw adapterFault("PROVIDER_NOT_INSTALLED", "", "Configured agent executable could not be started");
    }
    throw error;
  } finally {
    input.signal.removeEventListener("abort", abort);
  }
}

async function runCancellationCommand(command: string, args: string[], cwd: string | undefined, environment: Record<string, string> | undefined): Promise<void> {
  const executable = await resolveExecutable(command);
  if (!executable) throw adapterFault("PROVIDER_NOT_INSTALLED", "", "Configured cancellation executable was not found");
  if (cwd) {
    try { if (!(await stat(cwd)).isDirectory()) throw new Error("not a directory"); }
    catch { throw adapterFault("WORKSPACE_NOT_FOUND", "", "Configured agent workspace is unavailable"); }
  }
  const child = spawn(executable, args, {
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ...environment },
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 10_000);
  let code: number | null;
  try {
    code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) throw adapterFault("TIMEOUT", "", "Configured cancellation command exceeded its time limit", true);
  if (code !== 0) throw adapterFault("PROVIDER_UNAVAILABLE", "", "Configured cancellation command failed", true);
}

function stopChild(child: ChildProcessWithoutNullStreams | undefined): void {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2_000);
  forceTimer.unref();
}

function adapterFault(code: string, provider: string, message: string, retryable = false): Error & { code: string; provider: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, provider, retryable });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
