import type { AdapterError } from "../../domain/a2a-adapter.js";
import type { AgentResult, AgentTask } from "../../domain/collaboration/aggregates/task.js";
import type { A2AAgentInputDto, A2ATaskResultDto } from "../dto/a2a-collaboration.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapter, AgentExecutionContext } from "../ports/a2a-agent-adapter.js";
import { toA2ATaskDto, toDomainAgentResult } from "../mappers/a2a-collaboration-mapper.js";
import { normalizeAdapterError, runtimeFault } from "../validation/a2a-runtime-errors.js";
import { raceWithAbort } from "../validation/a2a-abort-race.js";
import { parseAgentResult } from "../validation/a2a-task-validation.js";
import type { TimerPort } from "../ports/timers.js";

export type A2AAdapterInvocationOutcome =
  | { kind: "result"; result: AgentResult }
  | { kind: "failure"; error: AdapterError; timedOut: boolean };

export type A2AAdapterInvocationInput = {
  provider: string;
  adapter: AgentAdapter;
  agentId: string;
  session: NativeSession;
  task: AgentTask;
  input: A2AAgentInputDto;
  context: AgentExecutionContext;
  controller: AbortController;
  timeoutMs: number | undefined;
  waitForPermissionCleanup: boolean;
  onCancellationFailure(): void;
  onCancellationUnsupported(): void;
};

/** Owns one adapter call's timeout, abort race, cancellation, and adapter error normalization. */
export class A2AAdapterInvocation {
  constructor(private readonly timers: TimerPort) {}

  async invoke(input: A2AAdapterInvocationInput): Promise<A2AAdapterInvocationOutcome> {
    let timedOut = false;
    const timeoutTimer = input.timeoutMs === undefined ? undefined : this.timers.schedule(() => {
      timedOut = true;
      input.controller.abort();
      if (input.adapter.capabilities.cancellation) {
        void Promise.resolve()
          .then(() => input.adapter.cancel(input.session, input.task.taskId))
          .catch(input.onCancellationFailure);
      } else {
        // The runtime can stop waiting, but it cannot claim the native task stopped.
        input.onCancellationUnsupported();
      }
    }, input.timeoutMs);

    let operation: Promise<A2ATaskResultDto> | undefined;
    try {
      operation = input.session.persistenceLevel === 3
        ? input.adapter.attach?.(input.session, input.input, input.context) ??
          Promise.reject(runtimeFault("ATTACH_UNSUPPORTED", input.provider, "Process attachment is unavailable"))
        : input.session.persistenceLevel === 2
          ? input.adapter.resume(input.session, input.input, input.context)
          : input.adapter.execute(input.session, toA2ATaskDto(input.task), input.context);
      const rawResult = await raceWithAbort(operation, input.controller.signal, () => timedOut);
      return {
        kind: "result",
        result: toDomainAgentResult(parseAgentResult(rawResult, input.task.taskId, input.agentId)),
      };
    } catch (error) {
      let effectiveError = error;
      if (input.controller.signal.aborted && input.waitForPermissionCleanup && input.adapter.capabilities.cancellation && operation) {
        // Let adapters finish permission restoration before the executor releases task locks.
        try {
          await operation;
        } catch (operationError) {
          effectiveError = operationError;
        }
      }
      return {
        kind: "failure",
        error: normalizeAdapterError(effectiveError, input.provider),
        timedOut,
      };
    } finally {
      if (timeoutTimer !== undefined) this.timers.cancel(timeoutTimer);
    }
  }
}
