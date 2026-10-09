import type { AdapterError } from "../../domain/a2a-adapter.js";
import type { AgentNode, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AgentResult, TaskState } from "../../domain/collaboration/aggregates/task.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import { InteractionPolicy } from "../../domain/collaboration/policies/interaction-policy.js";
import type { A2ATaskDirectoryPort } from "../ports/a2a-runtime.js";
import { isTerminalTask } from "../validation/a2a-runtime-copy.js";
import { normalizeAdapterError, runtimeFault } from "../validation/a2a-runtime-errors.js";

type A2ATaskResultApplierDependencies = {
  directory: Pick<A2ATaskDirectoryPort, "addHistory">;
  transitionTask(record: TaskAggregate, next: TaskState): void;
  finishWithResult(record: TaskAggregate, result: AgentResult): void;
  finishFailure(record: TaskAggregate, error: AdapterError): void;
  hasAcceptedResponseDelivery(taskId: string): boolean;
  setAgentState(agent: AgentNode, next: AgentNode["state"]): void;
  readClock(): number;
};

/** Applies adapter outcomes and task-specific completion/failure policy. */
export class A2ATaskResultApplier {
  constructor(private readonly dependencies: A2ATaskResultApplierDependencies) {}

  applyResult(
    record: TaskAggregate,
    agent: AgentNode,
    session: NativeSession,
    result: AgentResult,
  ): void {
    if (result.status === "COMPLETED") {
      const requiresDeliveredResponse = record.delivery?.value === "a2a-async-request" &&
        record.sourceAgentId !== undefined;
      const completionViolation = InteractionPolicy.taskCompletionViolation({
        requiresResponseDelivery: requiresDeliveredResponse,
        responseDeliveryAccepted: requiresDeliveredResponse
          ? this.dependencies.hasAcceptedResponseDelivery(record.task.taskId)
          : false,
      });
      if (completionViolation === "A2A_RESPONSE_DELIVERY_REQUIRED") {
        const message = "A2A responder completed without delivering its response to an agent";
        record.setError(runtimeFault("INVALID_REQUEST", agent.provider, message).detail);
        this.dependencies.finishWithResult(record, { ...result, status: "FAILED", message });
      } else {
        this.dependencies.finishWithResult(record, result);
        if (session.persistenceLevel === 1 && session.runtimeManagedHistory) {
          const createdAt = this.dependencies.readClock();
          this.dependencies.directory.addHistory(agent.agentId, [
            { taskId: record.task.taskId, role: "user", message: record.task.message, createdAt },
            { taskId: record.task.taskId, role: "assistant", message: result.message, createdAt },
          ]);
        }
      }
    } else if (result.status === "CANCELLED") {
      this.dependencies.finishWithResult(record, result);
    } else if (result.status === "TIMED_OUT") {
      this.dependencies.finishWithResult(record, result);
    } else {
      this.dependencies.finishWithResult(record, result);
    }
  }

  applyFailure(
    record: TaskAggregate,
    agent: AgentNode,
    error: unknown,
    timedOut: boolean,
    aborted: boolean,
  ): void {
    const adapterError = normalizeAdapterError(error, agent.provider);
    if (adapterError.code === "PERMISSION_RESTORE_FAILED") {
      if (agent.state !== "ERROR") this.dependencies.setAgentState(agent, "ERROR");
      this.dependencies.finishFailure(record, adapterError);
    } else if (timedOut) {
      record.setError(runtimeFault("TIMEOUT", agent.provider, "Agent task exceeded its timeout", true).detail);
      if (!isTerminalTask(record.state)) this.dependencies.transitionTask(record, "TIMED_OUT");
    } else if (aborted) {
      if (!isTerminalTask(record.state)) this.dependencies.transitionTask(record, "CANCELLED");
    } else {
      this.dependencies.finishFailure(record, adapterError);
    }
  }
}
