import type { AgentInput, AgentResult } from "../../domain/collaboration/aggregates/task.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type {
  A2ATaskAncestryDto,
  A2ATaskExecutionRequestDto,
  A2ATaskRecordDto,
  AgentNode,
} from "../../application/dto/a2a-collaboration.js";
import { toA2AAgentInputDto, toA2ATaskRecordDto } from "../mappers/a2a-collaboration-mapper.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import { TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import type { AgentAdapter, AgentExecutionContext } from "../ports/a2a-agent-adapter.js";
import type { A2AAgentSessionToolRequestDto as AgentSessionToolRequest } from "../dto/a2a-collaboration.js";
import { A2AAdapterInvocation } from "./a2a-adapter-invocation.js";
import { copyAgentSummary } from "../validation/a2a-runtime-copy.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import { A2ATaskResultApplier } from "./a2a-task-result-applier.js";
import {
  A2ATaskExecutionPreflight,
  type A2ATaskExecutionPreflightServices,
} from "./a2a-task-execution-preflight.js";

type A2ATaskExecutionServices = A2ATaskExecutionPreflightServices & {
  tasks: TaskRepository;
  emit(event: A2ARuntimeEvent): void;
  hasAcceptedResponseDelivery(taskId: string): boolean;
  finishWithResult(record: TaskAggregate, result: AgentResult): void;
  sendFromAgentWithAncestry(agentId: string, input: AgentSessionToolRequest, ancestry: A2ATaskAncestryDto): Promise<A2ATaskRecordDto>;
  addActive(agentId: string, taskId: string): void;
  removeActive(agentId: string, taskId: string): void;
  removeWaiting(agentId: string, taskId: string): void;
  setDerivedAgentState(agent: AgentNode): void;
  touchAgent(agent: AgentNode, timestamp: number): void;
  touchTask(record: TaskAggregate): void;
};

/** Executes one routed task, including adapter availability, permissions, locking, timeout, and cleanup. */
export class A2ATaskExecutor {
  private readonly preflight: A2ATaskExecutionPreflight;
  private readonly adapterInvocation: A2AAdapterInvocation;
  private readonly resultApplier: A2ATaskResultApplier;

  constructor(private readonly services: A2ATaskExecutionServices) {
    this.preflight = new A2ATaskExecutionPreflight(services);
    this.adapterInvocation = new A2AAdapterInvocation(services.timers);
    this.resultApplier = new A2ATaskResultApplier({
      directory: services.directory,
      transitionTask: services.transitionTask,
      finishWithResult: services.finishWithResult,
      finishFailure: services.finishFailure,
      hasAcceptedResponseDelivery: services.hasAcceptedResponseDelivery,
      setAgentState: (agent, next) => services.setAgentState(agent, next),
      readClock: () => this.readClock(),
    });
  }

  async execute(
    request: A2ATaskExecutionRequestDto,
    agent: AgentNode,
    adapter: AgentAdapter,
    parentSignal?: AbortSignal,
  ): Promise<A2ATaskRecordDto> {
    const record = this.services.tasks.findById(new TaskId(request.taskId));
    if (!record) throw runtimeFault("INVALID_REQUEST", agent.provider, "Task is no longer available for execution");
    const preparation = await this.preflight.prepare(record, agent, adapter, parentSignal);
    if (preparation.kind === "completed") return toA2ATaskRecordDto(preparation.record);
    const { session, controller, inheritedPermissions, adapterTimeoutMs, workspaceLock } = preparation;
    let timedOut = preparation.timedOut;
    this.services.addActive(agent.agentId, record.task.taskId);
    this.services.setAgentState(agent, "WORKING");
    this.services.transitionTask(record, "RUNNING");
    await this.services.persist();

    const taskAgentIds = new Set([record.task.sourceAgent, record.task.targetAgent]);
    const taskAgents = [...taskAgentIds].flatMap((agentId) => {
      const taskAgent = this.services.directory.getAgentSummary(agentId);
      return taskAgent ? [taskAgent] : [];
    });

    const context: AgentExecutionContext = {
      signal: controller.signal,
      history: [],
      agents: taskAgents,
      ...(inheritedPermissions ? { inheritedPermissions: { ...inheritedPermissions } } : {}),
      delegate: async (request) => {
        if (!adapter.capabilities.delegation) {
          throw runtimeFault("PERMISSION_DENIED", agent.provider, "This adapter does not expose task delegation");
        }
        if (controller.signal.aborted) throw runtimeFault("PROCESS_EXITED", agent.provider, "Parent task is no longer active");
        return this.services.sendFromAgentWithAncestry(agent.agentId, request, {
          parentTaskId: record.id.value,
          flowParentTaskId: record.id.value,
          sourceAgentId: agent.agentId,
        });
      },
    };
    try {
      const input: AgentInput = { task: record.task, message: record.task.message };
      const invocation = await this.adapterInvocation.invoke({
        provider: agent.provider,
        adapter,
        agentId: agent.agentId,
        session,
        task: record.task,
        input: toA2AAgentInputDto(input),
        context,
        controller,
        timeoutMs: adapterTimeoutMs,
        waitForPermissionCleanup: Boolean(inheritedPermissions),
        onCancellationFailure: () => {
          if (agent.state !== "ERROR") this.services.setAgentState(agent, "ERROR");
          void this.services.persist();
        },
        onCancellationUnsupported: () => {
          // The runtime can stop waiting, but it cannot claim the native task stopped.
          this.services.setAgentState(agent, "ERROR");
          void this.services.persist();
        },
      });
      if (invocation.kind === "failure") {
        timedOut = invocation.timedOut;
        throw invocation.error;
      }
      this.resultApplier.applyResult(record, agent, session, invocation.result);
    } catch (error) {
      this.resultApplier.applyFailure(record, agent, error, timedOut, controller.signal.aborted);
    } finally {
      workspaceLock.release?.();
      workspaceLock.release = undefined;
      this.services.clearWorkspaceLock(record.task.taskId);
      this.services.clearAbortController(record.task.taskId);
      this.services.removeActive(agent.agentId, record.task.taskId);
      this.services.removeWaiting(agent.agentId, record.task.taskId);
      this.services.touchAgent(agent, this.readClock());
      this.services.setDerivedAgentState(agent);
      this.services.touchTask(record);
      this.services.emit({ type: "task.updated", task: toA2ATaskRecordDto(record.toRecord()) });
      this.services.emit({ type: "agent.updated", agent: copyAgentSummary(agent) });
      await this.services.persist();
    }
    return toA2ATaskRecordDto(record.toRecord());
  }

  private readClock(): number {
    const value = this.services.now();
    if (!Number.isFinite(value)) throw new Error("A2A clock returned an invalid timestamp");
    return value;
  }
}
