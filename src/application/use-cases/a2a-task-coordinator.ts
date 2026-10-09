import type { RoutingPolicy } from "../../domain/collaboration/aggregates/task.js";
import { TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { AgentNode, AgentSummary, A2ATaskRecordDto } from "../../application/dto/a2a-collaboration.js";
import type { A2ACommunicationPermissionsDto } from "../dto/a2a-collaboration.js";
import type { AssistantEventPublisher } from "../ports/events.js";
import type {
  A2ATaskDirectoryPort,
  A2APermissionSourceDirectoryPort,
  A2ARuntimeEvent,
  A2ATaskWaitResult,
} from "../ports/a2a-runtime.js";
import type { A2AAgentSessionToolRequestDto as AgentSessionToolRequest } from "../dto/a2a-collaboration.js";
import type { A2ARuntimeDependencies, SubmitAgentTaskInput } from "./a2a-runtime-types.js";
import type {
  A2AAgentActivityDirectoryPort,
  A2ARuntimeDirectoryPort,
  A2ANativeSessionProvisioningDirectoryPort,
} from "../ports/a2a-runtime-directory.js";
import { validatePolicy } from "../validation/a2a-runtime-validation.js";
import { A2ATaskExecutor } from "./a2a-task-executor.js";
import { A2ATaskRecovery } from "./a2a-task-recovery.js";
import { A2ATaskTargetResolver } from "./a2a-task-target-resolver.js";
import { A2AAgentTargetSelection } from "./a2a-agent-target-selection.js";
import { A2ANativeSessionProvisioner } from "./a2a-native-session-provisioner.js";
import { A2AAgentActivity } from "./a2a-agent-activity.js";
import { A2AActiveAgentResolver } from "./a2a-active-agent-resolver.js";
import { A2ATaskResultPublisher } from "./a2a-task-result-publisher.js";
import { A2ATaskScheduler } from "./a2a-task-scheduler.js";
import { A2ATaskWaiter } from "./a2a-task-waiter.js";
import { A2AAgentTaskRouter } from "./a2a-agent-task-router.js";
import { A2ATaskCanceller } from "./a2a-task-canceller.js";
import type { A2ANativeSessionAgentResolver } from "./a2a-native-session-agent-resolver.js";
import { A2APendingAsyncRequests } from "./a2a-pending-async-requests.js";
import { A2ATaskQueries } from "./a2a-task-queries.js";
import { A2ATaskLifecycle } from "./a2a-task-lifecycle.js";
import type { A2AAgentStateTransitions } from "./a2a-agent-state-transitions.js";
import { toDomainRoutingPolicy } from "../mappers/a2a-collaboration-mapper.js";

type A2ATaskCoordinatorServices = Pick<
  A2ARuntimeDependencies,
  "workspaceLocks" | "timers" | "createId" | "now" | "publishAssistantEvent" | "policy" | "taskRepository" | "agentRepository"
> & {
  directory: A2ATaskDirectoryPort & A2APermissionSourceDirectoryPort & A2ARuntimeDirectoryPort & A2AAgentActivityDirectoryPort & A2ANativeSessionProvisioningDirectoryPort;
  stateTransitions: A2AAgentStateTransitions;
  nativeSessionAgentResolver: A2ANativeSessionAgentResolver;
  persist(): Promise<void>;
  emit(event: A2ARuntimeEvent): void;
  subscribe(handler: (event: A2ARuntimeEvent) => void): () => void;
  getCommunicationPermissions?(agentId: string): A2ACommunicationPermissionsDto | undefined;
  assertInitialized(): void;
};

/** Coordinates A2A task routing, waiting, cancellation, and lifecycle transitions. */
export class A2ATaskCoordinator {
  private readonly tasks: A2ARuntimeDependencies["taskRepository"];
  private readonly workspaceLockReleases = new Map<string, { release: (() => void) | undefined }>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly pendingAsyncRequests = new A2APendingAsyncRequests();
  private readonly executor: A2ATaskExecutor;
  private readonly targetSelection: A2AAgentTargetSelection;
  private readonly targetResolver: A2ATaskTargetResolver;
  private readonly policy: RoutingPolicy;
  private readonly directory: A2ATaskDirectoryPort & A2APermissionSourceDirectoryPort & A2ARuntimeDirectoryPort & A2AAgentActivityDirectoryPort & A2ANativeSessionProvisioningDirectoryPort;
  private readonly activity: A2AAgentActivity;
  private readonly taskQueries: A2ATaskQueries;
  private readonly activeAgentResolver: A2AActiveAgentResolver;
  private readonly taskLifecycle: A2ATaskLifecycle;
  private readonly scheduler: A2ATaskScheduler;
  private readonly taskWaiter: A2ATaskWaiter;
  private readonly agentTaskRouter: A2AAgentTaskRouter;
  private readonly taskCanceller: A2ATaskCanceller;
  private readonly taskRecovery: A2ATaskRecovery;

  constructor(private readonly dependencies: A2ATaskCoordinatorServices) {
    this.tasks = dependencies.taskRepository;
    this.directory = dependencies.directory;
    this.taskRecovery = new A2ATaskRecovery({
      directory: this.directory,
      readClock: () => this.readClock(),
    });
    this.activity = new A2AAgentActivity(this.directory, dependencies.stateTransitions);
    this.taskQueries = new A2ATaskQueries(
      this.tasks,
      () => this.assertInitialized(),
      (agentId) => this.activity.activeTaskCount(agentId),
    );
    const resultPublisher = new A2ATaskResultPublisher({
      directory: this.directory,
      getTaskGraph: (rootTaskId) => this.taskQueries.getTaskGraph(rootTaskId),
      ...(dependencies.publishAssistantEvent ? { publishAssistantEvent: dependencies.publishAssistantEvent } : {}),
    });
    this.taskLifecycle = new A2ATaskLifecycle({
      tasks: this.tasks,
      readClock: () => this.readClock(),
      emit: (event) => this.emit(event),
      publishTerminalResult: (record) => resultPublisher.publishForTerminalTask(record),
    });
    this.taskCanceller = new A2ATaskCanceller({
      tasks: this.tasks,
      getAbortController: (taskId) => this.abortControllers.get(taskId),
      resolveTarget: (agentId) => {
        const agent = this.directory.getAgentNode(agentId);
        return {
          agent,
          session: this.directory.getSession(agentId),
          adapter: agent ? this.directory.getAdapter(agent.adapterId) : undefined,
        };
      },
      assertInitialized: () => this.assertInitialized(),
      transitionTask: (record, next) => this.taskLifecycle.transition(record, next),
      setAgentState: (agent, next) => dependencies.stateTransitions.transition(agent, next),
      persist: () => this.persist(),
    });
    this.taskWaiter = new A2ATaskWaiter({
      tasks: this.tasks,
      directory: this.directory,
      activity: this.activity,
      workspaceLocks: dependencies.workspaceLocks,
      timers: dependencies.timers,
      workspaceLockReleases: this.workspaceLockReleases,
      abortControllers: this.abortControllers,
      subscribe: (handler) => dependencies.subscribe(handler),
      transitionTask: (record, next) => this.taskLifecycle.transition(record, next),
      readClock: () => this.readClock(),
      persist: () => this.persist(),
      assertInitialized: () => this.assertInitialized(),
    });
    this.activeAgentResolver = new A2AActiveAgentResolver({
      directory: this.directory,
      activity: this.activity,
      getTask: (taskId) => this.taskQueries.getTask(taskId),
      hasPendingRequest: (agentId) => this.pendingAsyncRequests.has(agentId),
      assertInitialized: () => this.assertInitialized(),
    });
    this.policy = toDomainRoutingPolicy(dependencies.policy);
    validatePolicy(this.policy);
    this.executor = new A2ATaskExecutor({
      tasks: this.tasks,
      directory: this.directory,
      workspaceLocks: dependencies.workspaceLocks,
      timers: dependencies.timers,
      now: dependencies.now,
      persist: () => this.persist(),
      emit: (event) => this.emit(event),
      transitionTask: (record, next) => this.taskLifecycle.transition(record, next),
      finishWithResult: (record, result) => this.taskLifecycle.finishWithResult(record, result),
      finishFailure: (record, error) => this.taskLifecycle.finishFailure(record, error),
      touchTask: (record) => this.taskLifecycle.touch(record),
      hasAcceptedResponseDelivery: (taskId) => this.taskQueries.hasAcceptedResponseDelivery(taskId),
      sendFromAgentWithAncestry: (agentId, input, ancestry) => this.agentTaskRouter.sendFromAgentWithAncestry(agentId, input, ancestry),
      addActive: (agentId, taskId) => this.activity.addActive(agentId, taskId),
      removeActive: (agentId, taskId) => this.activity.removeActive(agentId, taskId),
      removeWaiting: (agentId, taskId) => this.activity.removeWaiting(agentId, taskId),
      setDerivedAgentState: (agent) => this.activity.refreshAgentState(agent),
      touchAgent: (agent, timestamp) => dependencies.stateTransitions.touch(agent, timestamp),
      setAgentState: (agent, next, reason) => dependencies.stateTransitions.transition(agent, next, reason),
      getTask: (taskId) => this.taskQueries.getTask(taskId),
      setAbortController: (taskId, controller) => this.abortControllers.set(taskId, controller),
      clearAbortController: (taskId) => this.abortControllers.delete(taskId),
      setWorkspaceLock: (taskId, state) => this.workspaceLockReleases.set(taskId, state),
      clearWorkspaceLock: (taskId) => this.workspaceLockReleases.delete(taskId),
    });
    const sessionProvisioner = new A2ANativeSessionProvisioner({
      directory: this.directory,
      createAgentId: () => dependencies.createId("agent"),
    });
    this.targetSelection = new A2AAgentTargetSelection({
      directory: this.directory,
      agents: dependencies.agentRepository,
      policy: this.policy,
      agentLoad: (agentId) => this.taskQueries.agentLoad(agentId),
    });
    this.targetResolver = new A2ATaskTargetResolver({
      directory: this.directory,
      sessionProvisioner,
      selection: this.targetSelection,
    });
    this.scheduler = new A2ATaskScheduler({
      tasks: this.tasks,
      agents: dependencies.agentRepository,
      directory: this.directory,
      executor: this.executor,
      targetSelection: this.targetSelection,
      policy: this.policy,
      createTaskId: () => dependencies.createId("task"),
      now: dependencies.now,
      persist: () => this.persist(),
      emit: (event) => this.emit(event),
    });
    this.agentTaskRouter = new A2AAgentTaskRouter({
      directory: this.directory,
      nativeSessionAgentResolver: dependencies.nativeSessionAgentResolver,
      tasks: this.tasks,
      abortControllers: this.abortControllers,
      activeAgentResolver: this.activeAgentResolver,
      targetSelection: this.targetSelection,
      targetResolver: this.targetResolver,
      scheduler: this.scheduler,
      cancelTask: async (taskId) => { await this.cancelTask(taskId); },
      trackPendingAsyncRequest: (agentId) => this.pendingAsyncRequests.track(agentId),
      getCommunicationPermissions: dependencies.getCommunicationPermissions ?? (() => undefined),
      assertInitialized: () => this.assertInitialized(),
    });
  }

  restore(records: readonly A2ATaskRecordDto[]): boolean {
    return this.taskRecovery.restore(records, this.tasks);
  }

  async findActiveAgentForTarget(provider: string, target: string): Promise<AgentSummary | undefined> {
    return this.activeAgentResolver.findForTarget(provider, target);
  }

  async resolveActiveAgentForTarget(provider: string, target: string): Promise<AgentSummary | undefined> {
    return this.activeAgentResolver.resolveForTarget(provider, target);
  }

  async resolveActiveAgentForTask(provider: string, callerAgentId: string, nativeSessionId?: string): Promise<AgentSummary | undefined> {
    return this.activeAgentResolver.resolveForTask(provider, callerAgentId, nativeSessionId);
  }

  sendFromNativeSession(provider: string, nativeSessionId: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    return this.agentTaskRouter.sendFromNativeSession(provider, nativeSessionId, input);
  }

  sendFromActiveSession(provider: string, target: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    return this.agentTaskRouter.sendFromActiveSession(provider, target, input);
  }

  sendFromAgent(agentId: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    return this.agentTaskRouter.sendFromAgent(agentId, input);
  }

  getTask(taskId: string): A2ATaskRecordDto | undefined {
    return this.taskQueries.getTask(taskId);
  }

  waitForTask(taskId: string, waitMs = 20_000): Promise<A2ATaskWaitResult> {
    return this.taskWaiter.waitForTask(taskId, waitMs);
  }

  getTaskGraph(rootTaskId: string): A2ATaskRecordDto[] {
    return this.taskQueries.getTaskGraph(rootTaskId);
  }

  async submitTask(input: SubmitAgentTaskInput): Promise<A2ATaskRecordDto> {
    this.assertInitialized();
    return this.scheduler.schedule(input, {}).completion;
  }

  async enqueueTask(input: SubmitAgentTaskInput): Promise<A2ATaskRecordDto> {
    this.assertInitialized();
    const scheduled = this.scheduler.schedule(input, {});
    await scheduled.persisted;
    void scheduled.completion.catch(() => undefined);
    return scheduled.record;
  }

  cancelTask(taskId: string): Promise<A2ATaskRecordDto> {
    return this.taskCanceller.cancel(taskId);
  }

  private assertInitialized(): void { this.dependencies.assertInitialized(); }

  private findTask(taskId: string): TaskAggregate | undefined {
    if (typeof taskId !== "string" || taskId.length === 0) return undefined;
    return this.tasks.findById(new TaskId(taskId));
  }

  private readClock(): number {
    const value = this.dependencies.now();
    if (!Number.isFinite(value)) throw new Error("A2A clock returned an invalid timestamp");
    return value;
  }

  private persist(): Promise<void> { return this.dependencies.persist(); }
  private emit(event: A2ARuntimeEvent): void { this.dependencies.emit(event); }
}
