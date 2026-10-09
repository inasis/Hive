import type { AgentNode, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AdapterError } from "../../domain/a2a-adapter.js";
import type { AgentTaskRecord, TaskState } from "../../domain/collaboration/aggregates/task.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { TimerPort } from "../ports/timers.js";
import { isTerminalTask } from "../validation/a2a-runtime-copy.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import { raceWithAbort } from "../validation/a2a-abort-race.js";

export type A2ATaskAvailabilityCheckServices = {
  timers: TimerPort;
  persist(): Promise<void>;
  transitionTask(record: TaskAggregate, next: TaskState): void;
  finishFailure(record: TaskAggregate, error: AdapterError): void;
  setAgentState(
    agent: AgentNode,
    next: AgentNode["state"],
    offlineReason?: AgentNode["offlineReason"],
  ): void;
  clearAbortController(taskId: string): void;
};

/** Applies the timeout and failure policy for checking a provider session's availability. */
export class A2ATaskAvailabilityCheck {
  constructor(private readonly services: A2ATaskAvailabilityCheckServices) {}

  async check(
    record: TaskAggregate,
    agent: AgentNode,
    session: NativeSession,
    adapter: AgentAdapter,
    controller: AbortController,
    timeoutMs: number | undefined,
  ): Promise<{ kind: "available" } | { kind: "completed" }> {
    let timedOut = false;
    const timer = timeoutMs === undefined ? undefined : this.services.timers.schedule(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let available: boolean;
    try {
      available = await raceWithAbort(adapter.isAvailable(session), controller.signal, () => timedOut);
    } catch {
      if (timer !== undefined) this.services.timers.cancel(timer);
      this.services.clearAbortController(record.task.taskId);
      if (isTerminalTask(record.state)) return { kind: "completed" };
      this.services.setAgentState(agent, "OFFLINE", "ADAPTER_UNAVAILABLE");
      if (timedOut) {
        record.setError(runtimeFault("TIMEOUT", agent.provider, "Agent availability check exceeded the task timeout", true).detail);
        this.services.transitionTask(record, "TIMED_OUT");
      } else {
        this.services.finishFailure(
          record,
          runtimeFault("PROVIDER_UNAVAILABLE", agent.provider, "Agent adapter is unavailable", true).detail,
        );
      }
      await this.services.persist();
      return { kind: "completed" };
    }

    if (timer !== undefined) this.services.timers.cancel(timer);
    if (isTerminalTask(record.state)) {
      this.services.clearAbortController(record.task.taskId);
      return { kind: "completed" };
    }
    if (!available) {
      this.services.clearAbortController(record.task.taskId);
      this.services.setAgentState(agent, "OFFLINE", "SESSION_UNAVAILABLE");
      this.services.finishFailure(
        record,
        runtimeFault("SESSION_NOT_FOUND", agent.provider, "Native session is unavailable", true).detail,
      );
      await this.services.persist();
      return { kind: "completed" };
    }
    return { kind: "available" };
  }
}
