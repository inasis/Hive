import type { AgentNode, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import { TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { A2ATaskRecordDto } from "../dto/a2a-collaboration.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import { toA2ATaskRecordDto } from "../mappers/a2a-collaboration-mapper.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

type CancellationTarget = {
  agent: AgentNode | undefined;
  session: NativeSession | undefined;
  adapter: AgentAdapter | undefined;
};

type A2ATaskCancellerServices = {
  tasks: TaskRepository;
  getAbortController(taskId: string): AbortController | undefined;
  resolveTarget(agentId: string): CancellationTarget;
  assertInitialized(): void;
  transitionTask(record: TaskAggregate, next: "CANCELLED"): void;
  setAgentState(agent: AgentNode, next: AgentNode["state"]): void;
  persist(): Promise<void>;
};

/** Applies cancellation policy to one queued or active A2A task. */
export class A2ATaskCanceller {
  constructor(private readonly services: A2ATaskCancellerServices) {}

  async cancel(taskId: string): Promise<A2ATaskRecordDto> {
    this.services.assertInitialized();
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw runtimeFault("INVALID_REQUEST", "", "Task does not exist");
    }
    const record = this.services.tasks.findById(new TaskId(taskId));
    if (!record) throw runtimeFault("INVALID_REQUEST", "", "Task does not exist");
    if (record.state === "QUEUED") {
      this.services.getAbortController(taskId)?.abort();
      this.services.transitionTask(record, "CANCELLED");
      await this.services.persist();
      return toA2ATaskRecordDto(record.toRecord());
    }
    if (record.state !== "RUNNING" && record.state !== "WAITING") return toA2ATaskRecordDto(record.toRecord());

    const { agent, session, adapter } = this.services.resolveTarget(record.task.targetAgent);
    if (!agent || !session || !adapter) {
      throw runtimeFault("PROVIDER_UNAVAILABLE", agent?.provider ?? "", "Agent adapter is unavailable");
    }
    if (!adapter.capabilities.cancellation) {
      throw runtimeFault("CANCEL_UNSUPPORTED", agent.provider, "This adapter does not support task cancellation");
    }

    this.services.getAbortController(taskId)?.abort();
    void Promise.resolve().then(() => adapter.cancel(session, taskId)).catch(() => {
      if (agent.state !== "ERROR") this.services.setAgentState(agent, "ERROR");
      void this.services.persist();
    });
    if (record.state === "RUNNING" || record.state === "WAITING") this.services.transitionTask(record, "CANCELLED");
    await this.services.persist();
    return toA2ATaskRecordDto(record.toRecord());
  }
}
