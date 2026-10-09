import type { AgentTask, RoutingPolicy } from "../../domain/collaboration/aggregates/task.js";
import { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type {
  A2ATaskAncestryDto,
  A2ATaskExecutionRequestDto,
  A2ATaskRecordDto,
  A2ATaskSubmissionDto,
} from "../dto/a2a-collaboration.js";
import { toA2ATaskRecordDto } from "../mappers/a2a-collaboration-mapper.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import { AgentId, RoomId, TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import { TaskDelivery } from "../../domain/collaboration/value-objects/task-delivery.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import { validateSubmission } from "../validation/a2a-task-validation.js";
import type { A2ATaskExecutor } from "./a2a-task-executor.js";
import type { A2AAgentTargetSelection } from "./a2a-agent-target-selection.js";
import { isA2AFlowTask, resolveA2AFlowDepth, resolveA2AFlowId } from "./a2a-task-flow-lineage.js";

type TaskScheduleControl = {
  signal?: AbortSignal;
};

type ScheduledTask = {
  record: A2ATaskRecordDto;
  persisted: Promise<void>;
  completion: Promise<A2ATaskRecordDto>;
};

type A2ATaskSchedulerDependencies = {
  tasks: TaskRepository;
  agents: AgentRepository;
  directory: Pick<A2ARuntimeDirectoryPort, "requireRoom" | "getSession" | "requireAdapter">;
  executor: A2ATaskExecutor;
  targetSelection: A2AAgentTargetSelection;
  policy: RoutingPolicy;
  createTaskId(): string;
  now(): number;
  persist(): Promise<void>;
  emit(event: A2ARuntimeEvent): void;
};

/** Validates task submissions, establishes their lineage, and schedules provider execution. */
export class A2ATaskScheduler {
  private readonly serialTails = new Map<string, Promise<void>>();

  constructor(private readonly dependencies: A2ATaskSchedulerDependencies) {}

  schedule(
    input: A2ATaskSubmissionDto,
    ancestry: A2ATaskAncestryDto,
    control: TaskScheduleControl = {},
  ): ScheduledTask {
    validateSubmission(input);
    const { directory, tasks, policy } = this.dependencies;
    const room = directory.requireRoom(input.roomId);
    const hasTarget = input.targetAgent !== undefined || input.targetSessionName !== undefined;
    if (hasTarget === (input.selector !== undefined)) {
      throw runtimeFault("INVALID_REQUEST", "", "Specify a session name/agent ID or a selector");
    }

    const parent = this.findAncestryTask(ancestry.parentTaskId, "parentTaskId");
    const flowParentId = ancestry.flowParentTaskId ?? ancestry.parentTaskId;
    const flowParent = flowParentId === ancestry.parentTaskId
      ? parent
      : this.findAncestryTask(flowParentId, "flowParentTaskId");
    const callbackForTaskId = typeof input.metadata?.callbackForTaskId === "string" ? input.metadata.callbackForTaskId : undefined;
    const callbackReference = callbackForTaskId ? tasks.findById(new TaskId(callbackForTaskId)) : undefined;
    const delivery = TaskDelivery.from(input.metadata?.delivery);
    const a2aFlowDelivery = delivery?.isA2AFlow === true;
    const flowBase = isA2AFlowTask(flowParent)
      ? flowParent
      : isA2AFlowTask(callbackReference) ? callbackReference : undefined;
    const flowId = a2aFlowDelivery ? (flowBase ? resolveA2AFlowId(flowBase, tasks) : undefined) : undefined;
    const flowDepth = a2aFlowDelivery ? (flowBase ? resolveA2AFlowDepth(flowBase, tasks) + 1 : 0) : undefined;
    const maxDepth = input.maxDepth ?? parent?.task.maxDepth ?? flowParent?.task.maxDepth ?? callbackReference?.task.maxDepth ?? policy.maxDepth;
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > policy.maxDepth) {
      throw runtimeFault("INVALID_REQUEST", "", "maxDepth is outside the routing policy");
    }
    const depth = parent ? parent.task.depth + 1 : 0;
    if (depth > maxDepth) throw runtimeFault("MAX_DEPTH_EXCEEDED", "", "Delegation depth limit reached");
    if (flowDepth !== undefined && flowDepth > maxDepth) {
      throw runtimeFault("MAX_DEPTH_EXCEEDED", "", "A2A flow depth limit reached");
    }
    const timeoutMs = input.timeoutMs ?? policy.defaultTimeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw runtimeFault("INVALID_REQUEST", "", "timeoutMs must be a non-negative integer");
    const sourceAgent = parent?.task.targetAgent ?? ancestry.sourceAgentId ?? "orchestrator";
    if (parent && !parent.canCreateChildInRoom(new RoomId(room.roomId))) {
      throw runtimeFault("INVALID_REQUEST", "", "Delegation must remain in its room");
    }
    const requiresResponseDelivery = delivery?.value === "a2a-async-request" && sourceAgent !== "orchestrator";

    const visited = parent ? [...parent.task.visitedAgents] : [];
    const selectionVisited = a2aFlowDelivery ? [] : visited;
    const agent = ancestry.resolvedTargetAgentId
      ? this.dependencies.targetSelection.selectResolvedAgent(room, ancestry.resolvedTargetAgentId, input.selector, selectionVisited, requiresResponseDelivery)
      : this.dependencies.targetSelection.selectAgent(room, input.targetSessionName, input.targetAgent, input.selector, selectionVisited, requiresResponseDelivery);
    if (!parent && ancestry.sourceAgentId === agent.agentId) {
      throw runtimeFault("CYCLE_DETECTED", agent.provider, "An agent cannot assign a top-level task to its own session");
    }
    const id = this.uniqueTaskId();
    const session = directory.getSession(agent.agentId);
    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      ...(session?.callerAgentId ? { callerAgentId: session.callerAgentId } : {}),
    };
    if (a2aFlowDelivery) {
      metadata.a2aFlowId = flowId ?? id;
      metadata.a2aFlowDepth = flowDepth;
    }
    const task: AgentTask = {
      taskId: id,
      rootTaskId: parent?.task.rootTaskId ?? id,
      roomId: room.roomId,
      sourceAgent,
      targetAgent: agent.agentId,
      type: "REQUEST",
      message: input.message,
      depth,
      maxDepth,
      timeoutMs,
      createdAt: this.readClock(),
      visitedAgents: [...visited, agent.agentId],
      ...(parent ? { parentTaskId: parent.task.taskId } : {}),
      metadata,
    };
    const agentAggregate = this.dependencies.agents.findById(new AgentId(agent.agentId));
    if (!agentAggregate) {
      throw runtimeFault("NO_AGENT_AVAILABLE", agent.provider, "Target agent is not available for this task");
    }
    const adapter = directory.requireAdapter(agent.adapterId);
    const record = agentAggregate.createTask(task, {
      concurrentExecutionSupported: adapter.capabilities.concurrentTasks,
      queueingAllowed: policy.allowQueueing,
    });
    if (!record) {
      throw runtimeFault("NO_AGENT_AVAILABLE", agent.provider, "Target agent is not available for this task");
    }
    tasks.save(record);
    const acceptedRecord = toA2ATaskRecordDto(record.toRecord());
    this.dependencies.emit({ type: "task.updated", task: acceptedRecord });

    const persisted = this.dependencies.persist();
    const execute = async (): Promise<A2ATaskRecordDto> => {
      await persisted;
      const executionRequest: A2ATaskExecutionRequestDto = { taskId: record.id.value };
      return this.dependencies.executor.execute(executionRequest, agent, adapter, control.signal);
    };
    let completion: Promise<A2ATaskRecordDto>;
    if (adapter.capabilities.concurrentTasks) {
      completion = execute();
    } else {
      const previous = this.serialTails.get(agent.agentId) ?? Promise.resolve();
      completion = previous.catch(() => undefined).then(execute);
      const tail = completion.then(() => undefined, () => undefined);
      this.serialTails.set(agent.agentId, tail);
      void tail.then(() => {
        if (this.serialTails.get(agent.agentId) === tail) this.serialTails.delete(agent.agentId);
      });
    }
    return { record: acceptedRecord, persisted, completion };
  }

  private uniqueTaskId(): string {
    const taskId = this.dependencies.createTaskId();
    if (typeof taskId !== "string" || !taskId || this.dependencies.tasks.findById(new TaskId(taskId))) {
      throw runtimeFault("INVALID_REQUEST", "", "Task ID generator returned an invalid or duplicate ID");
    }
    return taskId;
  }

  private findAncestryTask(taskId: string | undefined, field: string): TaskAggregate | undefined {
    if (taskId === undefined) return undefined;
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw runtimeFault("INVALID_REQUEST", "", `${field} must be a non-empty task ID`);
    }
    const task = this.dependencies.tasks.findById(new TaskId(taskId));
    if (!task) throw runtimeFault("INVALID_REQUEST", "", `${field} does not identify an available task`);
    return task;
  }

  private readClock(): number {
    const value = this.dependencies.now();
    if (!Number.isFinite(value)) throw new Error("A2A clock returned an invalid timestamp");
    return value;
  }
}
