import type { A2ACommunicationPermissionsDto } from "../dto/a2a-collaboration.js";
import { A2ARuntimeDirectory } from "./a2a-runtime-directory.js";
import { A2ATaskCoordinator } from "./a2a-task-coordinator.js";
import { A2ANativeSessionAgentResolver } from "./a2a-native-session-agent-resolver.js";
import type {
  A2ARuntimeDependencies,
  AgentProfileUpdate,
  SubmitAgentTaskInput,
} from "./a2a-runtime-types.js";
import type {
  A2ARuntimeEvent,
  A2ARuntimeEventHandler,
  A2ARuntimeAdminPort,
  A2ADiscoveryResult,
  A2ATaskWaitResult,
} from "../ports/a2a-runtime.js";
import type { AgentAdapterDescriptor } from "../ports/a2a-agent-adapter.js";
import type { A2AAgentSessionToolRequestDto as AgentSessionToolRequest } from "../dto/a2a-collaboration.js";
import type { A2ATaskSnapshotSource } from "../ports/a2a-task-snapshot-source.js";
import { A2AAgentStateTransitions } from "./a2a-agent-state-transitions.js";
import { A2ARuntimeEventBus } from "./a2a-runtime-event-bus.js";
import { A2ARuntimeStatePersistence } from "./a2a-runtime-state-persistence.js";
import {
  toA2AAgentSummaryDto,
  toA2ARegisteredAgentDto,
  toA2ARoomDto,
} from "../mappers/a2a-collaboration-mapper.js";
import type {
  A2AAgentSummaryDto,
  A2ARegisterAgentDto,
  A2ARegisteredAgentDto,
  A2ARoomDto,
  A2ATaskRecordDto,
} from "../dto/a2a-collaboration.js";

/** Composes the session directory and asynchronous task coordinator. */
export class A2ARuntime implements A2ARuntimeAdminPort {
  private readonly directory: A2ARuntimeDirectory;
  private readonly nativeSessionAgentResolver: A2ANativeSessionAgentResolver;
  private readonly taskCoordinator: A2ATaskCoordinator;
  private readonly statePersistence: A2ARuntimeStatePersistence;
  private readonly eventBus = new A2ARuntimeEventBus();
  private readonly communicationPermissions = new Map<string, A2ACommunicationPermissionsDto>();
  private initialized = false;

  constructor(private readonly dependencies: A2ARuntimeDependencies) {
    const stateTransitions = new A2AAgentStateTransitions({
      agents: dependencies.agentRepository,
      now: dependencies.now,
      emit: this.eventBus.publish,
    });
    this.directory = new A2ARuntimeDirectory({
      adapters: dependencies.adapters,
      ...(dependencies.sessionIdentities ? { sessionIdentities: dependencies.sessionIdentities } : {}),
      stateTransitions,
      agentRepository: dependencies.agentRepository,
      roomRepository: dependencies.roomRepository,
      createId: dependencies.createId,
      now: dependencies.now,
      persist: () => this.persist(),
      emit: this.eventBus.publish,
    });
    this.nativeSessionAgentResolver = new A2ANativeSessionAgentResolver({
      directory: this.directory,
      assertInitialized: () => this.assertInitialized(),
    });
    this.taskCoordinator = new A2ATaskCoordinator({
      directory: this.directory,
      stateTransitions,
      nativeSessionAgentResolver: this.nativeSessionAgentResolver,
      taskRepository: dependencies.taskRepository,
      agentRepository: dependencies.agentRepository,
      workspaceLocks: dependencies.workspaceLocks,
      timers: dependencies.timers,
      createId: dependencies.createId,
      now: dependencies.now,
      ...(dependencies.publishAssistantEvent ? { publishAssistantEvent: dependencies.publishAssistantEvent } : {}),
      ...(dependencies.policy ? { policy: dependencies.policy } : {}),
      persist: () => this.persist(),
      emit: this.eventBus.publish,
      subscribe: this.eventBus.subscribe,
      getCommunicationPermissions: (agentId) => this.communicationPermissions.get(agentId),
      assertInitialized: () => this.assertInitialized(),
    });
    this.statePersistence = new A2ARuntimeStatePersistence(
      dependencies.stateStore,
      this.directory,
      resolveTaskSnapshotSource(dependencies.taskSnapshotSource, dependencies.taskRepository),
      () => this.communicationPermissions,
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const snapshot = await this.statePersistence.load();
    const directoryRecovered = await this.directory.restore(snapshot);
    const tasksRecovered = this.taskCoordinator.restore(snapshot.tasks);
    for (const { agentId, permissions } of snapshot.communicationPermissions ?? []) {
      this.communicationPermissions.set(agentId, { ...permissions });
    }
    this.initialized = true;
    if (directoryRecovered || tasksRecovered) await this.persist();
  }

  subscribe(handler: A2ARuntimeEventHandler): () => void {
    return this.eventBus.subscribe(handler);
  }

  listAdapters(): AgentAdapterDescriptor[] {
    return this.directory.listAdapters();
  }

  async ensureSessionsDiscovered(roomId: string): Promise<void> {
    this.assertInitialized();
    return this.directory.ensureSessionsDiscovered(roomId);
  }

  /** Mark provider session catalogs stale after Hive creates a session. */
  invalidateSessionDiscovery(): void {
    this.directory.invalidateSessionDiscovery();
  }

  async markNativeSessionUnavailable(provider: string, target: string, nativeSessionId: string): Promise<boolean> {
    this.assertInitialized();
    return this.directory.markNativeSessionUnavailable(provider, target, nativeSessionId);
  }

  listRooms(): A2ARoomDto[] {
    this.assertInitialized();
    return this.directory.listRooms().map(toA2ARoomDto);
  }

  listAgents(roomId: string): A2AAgentSummaryDto[] {
    this.assertInitialized();
    return this.directory.listAgents(roomId).map(toA2AAgentSummaryDto);
  }

  listAgentsForAgent(agentId: string): A2AAgentSummaryDto[] {
    this.assertInitialized();
    return this.directory.listAgentsForAgent(agentId).map(toA2AAgentSummaryDto);
  }

  async ensureSessionsDiscoveredForAgent(agentId: string): Promise<void> {
    this.assertInitialized();
    const room = this.directory.getRoomForAgent(agentId);
    if (!room) return;
    await this.directory.ensureSessionsDiscovered(room.roomId);
  }

  findAgentForNativeSession(provider: string, nativeSessionId: string): A2AAgentSummaryDto | undefined {
    this.assertInitialized();
    const agent = this.directory.findAgentForNativeSession(provider, nativeSessionId);
    return agent ? toA2AAgentSummaryDto(agent) : undefined;
  }

  async resolveNativeSessionAgent(provider: string, nativeSessionId: string): Promise<A2AAgentSummaryDto | undefined> {
    const agent = await this.nativeSessionAgentResolver.resolve(provider, nativeSessionId);
    return agent ? toA2AAgentSummaryDto(agent) : undefined;
  }

  async setSessionCommunicationPermissions(
    provider: string,
    nativeSessionId: string,
    permissions: A2ACommunicationPermissionsDto,
  ): Promise<void> {
    if (!this.initialized) return;
    const agent = await this.nativeSessionAgentResolver.resolve(provider, nativeSessionId);
    if (!agent) return;
    const current = this.communicationPermissions.get(agent.agentId);
    if (current?.a2a === permissions.a2a && current.a2b === permissions.a2b) return;
    this.communicationPermissions.set(agent.agentId, { ...permissions });
    await this.persist();
  }

  async findActiveAgentForTarget(provider: string, target: string): Promise<A2AAgentSummaryDto | undefined> {
    const agent = await this.taskCoordinator.findActiveAgentForTarget(provider, target);
    return agent ? toA2AAgentSummaryDto(agent) : undefined;
  }
  async resolveActiveAgentForTarget(provider: string, target: string): Promise<A2AAgentSummaryDto | undefined> {
    const agent = await this.taskCoordinator.resolveActiveAgentForTarget(provider, target);
    return agent ? toA2AAgentSummaryDto(agent) : undefined;
  }
  async resolveActiveAgentForTask(provider: string, callerAgentId: string, nativeSessionId?: string): Promise<A2AAgentSummaryDto | undefined> {
    const agent = await this.taskCoordinator.resolveActiveAgentForTask(provider, callerAgentId, nativeSessionId);
    return agent ? toA2AAgentSummaryDto(agent) : undefined;
  }
  async sendFromNativeSession(provider: string, nativeSessionId: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    return this.taskCoordinator.sendFromNativeSession(provider, nativeSessionId, input);
  }
  async sendFromActiveSession(provider: string, target: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    return this.taskCoordinator.sendFromActiveSession(provider, target, input);
  }
  async sendFromAgent(agentId: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    return this.taskCoordinator.sendFromAgent(agentId, input);
  }
  getTask(taskId: string): A2ATaskRecordDto | undefined {
    return this.taskCoordinator.getTask(taskId);
  }
  async waitForTask(taskId: string, waitMs = 20_000): Promise<A2ATaskWaitResult> {
    return this.taskCoordinator.waitForTask(taskId, waitMs);
  }
  getTaskGraph(rootTaskId: string): A2ATaskRecordDto[] { return this.taskCoordinator.getTaskGraph(rootTaskId); }
  async createRoom(roomId: string, name: string): Promise<A2ARoomDto> {
    this.assertInitialized();
    return toA2ARoomDto(await this.directory.createRoom(roomId, name));
  }

  async registerAgent(roomId: string, input: A2ARegisterAgentDto): Promise<A2ARegisteredAgentDto> {
    this.assertInitialized();
    return toA2ARegisteredAgentDto(await this.directory.registerAgent(roomId, input));
  }

  async updateAgentProfile(agentId: string, update: AgentProfileUpdate): Promise<A2AAgentSummaryDto> {
    this.assertInitialized();
    return toA2AAgentSummaryDto(await this.directory.updateAgentProfile(agentId, update));
  }

  async discoverSessions(roomId: string, adapterId?: string): Promise<A2ADiscoveryResult> {
    this.assertInitialized();
    const result = await this.directory.discoverSessions(roomId, adapterId);
    return { ...result, registered: result.registered.map(toA2AAgentSummaryDto) };
  }

  async refreshAvailability(roomId: string): Promise<A2AAgentSummaryDto[]> {
    this.assertInitialized();
    return (await this.directory.refreshAvailability(roomId)).map(toA2AAgentSummaryDto);
  }

  async submitTask(input: SubmitAgentTaskInput): Promise<A2ATaskRecordDto> { return this.taskCoordinator.submitTask(input); }
  async enqueueTask(input: SubmitAgentTaskInput): Promise<A2ATaskRecordDto> { return this.taskCoordinator.enqueueTask(input); }
  async cancelTask(taskId: string): Promise<A2ATaskRecordDto> { return this.taskCoordinator.cancelTask(taskId); }
  private assertInitialized(): void {
    if (!this.initialized) throw new Error("A2ARuntime.initialize() must be called first");
  }

  private persist(): Promise<void> {
    return this.statePersistence.persist();
  }
}

function resolveTaskSnapshotSource(
  snapshotSource: A2ATaskSnapshotSource | undefined,
  taskRepository: A2ARuntimeDependencies["taskRepository"],
): A2ATaskSnapshotSource {
  if (snapshotSource) return snapshotSource;
  if ("readTaskRecordsForSnapshot" in taskRepository &&
      typeof taskRepository.readTaskRecordsForSnapshot === "function") {
    return taskRepository as A2ARuntimeDependencies["taskRepository"] & A2ATaskSnapshotSource;
  }
  throw new Error("A2A runtime requires a Task snapshot source");
}
