import type { A2AAgentHistoryEntryDto } from "../dto/a2a-collaboration.js";
import type { AgentNode, AgentRoom, AgentSummary, NativeSession } from "../../application/dto/a2a-collaboration.js";
import { agentAggregateFromNode, applyAgentAggregate } from "../mappers/a2a-agent-mapper.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import type { RoomRepository } from "../../domain/collaboration/repositories/room-repository.js";
import { AgentId, TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { A2ARuntimeSnapshot } from "../dto/a2a-runtime-snapshot.js";
import type {
  A2APermissionSourceDirectoryPort,
  A2ARuntimeEvent,
  A2ATaskDirectoryPort,
} from "../ports/a2a-runtime.js";
import type { AgentAdapter, AgentAdapterDescriptor } from "../ports/a2a-agent-adapter.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import type { A2AAgentStateTransitions } from "./a2a-agent-state-transitions.js";
import { A2ACallerAgentIdAllocator } from "./a2a-caller-agent-id-allocator.js";
import type {
  AgentProfileUpdate,
  DiscoveryResult,
  RegisterAgentInput,
  A2ARuntimeDependencies,
} from "./a2a-runtime-types.js";
import { A2AAdapterRegistry } from "./a2a-adapter-registry.js";
import { A2ASessionDiscovery } from "./a2a-session-discovery.js";
import { A2ASessionIdentityResolver } from "./a2a-session-identity-resolver.js";
import { A2AAgentAvailability } from "./a2a-agent-availability.js";
import { A2AAgentRegistration } from "./a2a-agent-registration.js";
import { A2ASessionIdentityRestorer } from "./a2a-session-identity-restorer.js";
import { A2AAgentProfileUpdater } from "./a2a-agent-profile-updater.js";
import { A2ADirectoryStateSnapshot, type A2ADirectorySnapshot } from "./a2a-directory-state-snapshot.js";
import { A2ARoomDirectory } from "./a2a-room-directory.js";
import { A2ARuntimeDirectoryQueries } from "./a2a-runtime-directory-queries.js";

type A2ARuntimeDirectoryServices = Pick<A2ARuntimeDependencies, "adapters" | "sessionIdentities" | "createId" | "now"> & {
  agentRepository: AgentRepository;
  roomRepository: RoomRepository;
  stateTransitions: A2AAgentStateTransitions;
  persist(): Promise<void>;
  emit(event: A2ARuntimeEvent): void;
};

/** Owns room, agent, and native-session registration and discovery. */
export class A2ARuntimeDirectory implements A2ATaskDirectoryPort, A2APermissionSourceDirectoryPort, A2ARuntimeDirectoryPort {
  private readonly adapterRegistry: A2AAdapterRegistry;
  private readonly roomMap = new Map<string, AgentRoom>();
  private readonly agentMap = new Map<string, AgentNode>();
  private readonly sessionMap = new Map<string, NativeSession>();
  private readonly historyMap = new Map<string, A2AAgentHistoryEntryDto[]>();
  private readonly sessionDiscovery: A2ASessionDiscovery;
  private readonly sessionIdentityResolver: A2ASessionIdentityResolver;
  private readonly callerAgentIds: A2ACallerAgentIdAllocator;
  private readonly stateSnapshot: A2ADirectoryStateSnapshot;
  private readonly roomDirectory: A2ARoomDirectory;
  private readonly queries: A2ARuntimeDirectoryQueries;
  private readonly availability: A2AAgentAvailability;
  private readonly agentRegistration: A2AAgentRegistration;
  private readonly sessionIdentityRestorer: A2ASessionIdentityRestorer;
  private readonly agentProfileUpdater: A2AAgentProfileUpdater;
  private initialized = false;

  constructor(private readonly dependencies: A2ARuntimeDirectoryServices) {
    this.adapterRegistry = new A2AAdapterRegistry(dependencies.adapters);
    this.roomDirectory = new A2ARoomDirectory({
      rooms: this.roomMap,
      agents: this.agentMap,
      roomRepository: dependencies.roomRepository,
      assertInitialized: () => this.assertInitialized(),
      readClock: () => this.readClock(),
      persist: () => this.persist(),
      emit: (event) => this.emit(event),
    });
    this.queries = new A2ARuntimeDirectoryQueries(
      this.agentMap,
      this.sessionMap,
      this.adapterRegistry,
      this.roomDirectory,
      () => this.assertInitialized(),
    );
    this.callerAgentIds = new A2ACallerAgentIdAllocator({
      agents: this.agentMap,
      sessions: this.sessionMap,
      createId: (kind) => dependencies.createId(kind),
    });
    this.sessionIdentityResolver = new A2ASessionIdentityResolver({
      ...(dependencies.sessionIdentities ? { identityPort: dependencies.sessionIdentities } : {}),
      callerAgentIds: this.callerAgentIds,
    });
    this.agentRegistration = new A2AAgentRegistration({
      requireRoom: (roomId) => this.requireRoom(roomId),
      requireAdapter: (adapterId) => this.requireAdapter(adapterId),
      hasAgent: (agentId) => this.agentMap.has(agentId),
      hasRegisteredNativeSession: (session) => [...this.sessionMap.values()].some((registered) =>
        registered.sessionId === session.sessionId && registered.provider === session.provider),
      hasCallerAgentId: (callerAgentId) => [...this.agentMap.values()].some((agent) => agent.callerAgentId === callerAgentId),
      resolveSessionIdentity: (adapter, session) => this.sessionIdentityResolver.resolve(adapter, session),
      register: (agent, session, room) => {
        dependencies.agentRepository.save(agentAggregateFromNode(agent));
        this.agentMap.set(agent.agentId, agent);
        this.sessionMap.set(agent.agentId, session);
        this.roomDirectory.addAgent(room, agent.agentId);
      },
      readClock: () => this.readClock(),
      persist: () => this.persist(),
      emit: (event) => this.emit(event),
    });
    this.sessionIdentityRestorer = new A2ASessionIdentityRestorer({
      adapterForAgent: (agent) => this.adapterRegistry.adapters.get(agent.adapterId),
      resolveIdentity: (adapter, session) => this.sessionIdentityResolver.resolve(adapter, session),
      callerAgentIds: this.callerAgentIds,
      storeRestoredSession: (agentId, session, agent) => {
        this.sessionMap.set(agentId, session);
        if (agent) {
          this.agentMap.set(agentId, agent);
          dependencies.agentRepository.save(agentAggregateFromNode(agent));
        }
      },
    });
    this.stateSnapshot = new A2ADirectoryStateSnapshot(
      this.roomMap,
      this.agentMap,
      this.sessionMap,
      this.historyMap,
      this.sessionIdentityRestorer,
      (agent) => this.adapterRegistry.adapters.get(agent.adapterId),
      dependencies.agentRepository,
      dependencies.roomRepository,
    );
    this.agentProfileUpdater = new A2AAgentProfileUpdater({
      agents: dependencies.agentRepository,
      getAgent: (agentId) => this.agentMap.get(agentId),
      readClock: () => this.readClock(),
      persist: () => this.persist(),
      emit: (event) => this.emit(event),
    });
    this.availability = new A2AAgentAvailability({
      directory: this,
      stateTransitions: dependencies.stateTransitions,
      assertInitialized: () => this.assertInitialized(),
      persist: () => this.persist(),
    });
    this.sessionDiscovery = new A2ASessionDiscovery({
      rooms: this.roomMap,
      agents: this.agentMap,
      adapters: this.adapterRegistry.adapters,
      getSession: (agentId) => this.sessionMap.get(agentId),
      setSession: (agentId, session) => this.sessionMap.set(agentId, session),
      saveAgent: (agent) => dependencies.agentRepository.save(agentAggregateFromNode(agent)),
      addAgentToRoom: (room, agentId) => { this.roomDirectory.addAgent(room, agentId); },
      touchAgent: (agent, timestamp) => {
        const aggregate = dependencies.agentRepository.findById(new AgentId(agent.agentId)) ?? agentAggregateFromNode(agent);
        aggregate.touch(timestamp);
        dependencies.agentRepository.save(aggregate);
        applyAgentAggregate(agent, aggregate);
      },
      requireRoom: (roomId) => this.requireRoom(roomId),
      requireAdapter: (adapterId) => this.requireAdapter(adapterId),
      registerAgent: (roomId, input) => this.registerAgent(roomId, input),
      sessionIdentityForSession: (adapter, session) => this.sessionIdentityResolver.resolve(adapter, session),
      createAgentId: () => dependencies.createId("agent"),
      assertInitialized: () => this.assertInitialized(),
      readClock: () => this.readClock(),
      persist: () => this.persist(),
      emit: (event) => this.emit(event),
    });
  }

  getSession(agentId: string): NativeSession | undefined {
    return this.queries.getSession(agentId);
  }

  getAgentNode(agentId: string): AgentNode | undefined {
    return this.queries.getAgentNode(agentId);
  }

  listAgentNodes(): AgentNode[] {
    return this.queries.listAgentNodes();
  }

  getAdapter(adapterId: string): AgentAdapter | undefined {
    return this.queries.getAdapter(adapterId);
  }

  getRoomForAgent(agentId: string): AgentRoom | undefined {
    return this.roomDirectory.getRoomForAgent(agentId);
  }

  listRoomAgentNodes(roomId: string): AgentNode[] {
    return this.queries.listRoomAgentNodes(roomId);
  }

  hasAgent(agentId: string): boolean {
    return this.queries.hasAgent(agentId);
  }

  getAgentSummary(agentId: string): AgentSummary | undefined {
    return this.queries.getAgentSummary(agentId);
  }

  getPermissionSource(agentId: string, roomId: string): {
    agentId: string;
    provider: string;
    session: NativeSession;
    adapter: AgentAdapter;
  } | undefined {
    return this.queries.getPermissionSource(agentId, roomId);
  }

  async restore(snapshot: A2ARuntimeSnapshot): Promise<boolean> {
    const hasRestoredState = await this.stateSnapshot.restore(snapshot);
    this.initialized = true;
    return hasRestoredState;
  }

  snapshot(): A2ADirectorySnapshot {
    return this.stateSnapshot.snapshot();
  }

  addHistory(agentId: string, entries: readonly A2AAgentHistoryEntryDto[]): void {
    const history = this.historyMap.get(agentId) ?? [];
    history.push(...entries.map((entry) => ({ ...entry })));
    this.historyMap.set(agentId, history);
  }

  setCurrentTaskId(agentId: string, taskId: string | undefined): void {
    const agent = this.agentMap.get(agentId);
    if (!agent) return;
    const aggregate = this.dependencies.agentRepository.findById(new AgentId(agentId)) ?? agentAggregateFromNode(agent);
    aggregate.setCurrentTaskId(taskId ? new TaskId(taskId) : undefined);
    this.dependencies.agentRepository.save(aggregate);
    applyAgentAggregate(agent, aggregate);
  }

  listAdapters(): AgentAdapterDescriptor[] {
    return this.queries.listAdapters();
  }

  listRooms(): AgentRoom[] {
    return this.roomDirectory.listRooms();
  }

  listAgents(roomId: string): AgentSummary[] {
    return this.roomDirectory.listAgents(roomId);
  }

  listAgentsForAgent(agentId: string): AgentSummary[] {
    return this.roomDirectory.listAgentsForAgent(agentId);
  }

  findAgentForNativeSession(provider: string, nativeSessionId: string): AgentSummary | undefined {
    return this.queries.findAgentForNativeSession(provider, nativeSessionId);
  }

  async createRoom(roomId: string, name: string): Promise<AgentRoom> {
    return this.roomDirectory.createRoom(roomId, name);
  }

  async registerAgent(roomId: string, input: RegisterAgentInput): Promise<AgentNode> {
    this.assertInitialized();
    return this.agentRegistration.registerAgent(roomId, input);
  }

  async updateAgentProfile(agentId: string, update: AgentProfileUpdate): Promise<AgentSummary> {
    this.assertInitialized();
    return this.agentProfileUpdater.update(agentId, update);
  }

  ensureSessionsDiscovered(roomId: string): Promise<void> {
    return this.sessionDiscovery.ensureSessionsDiscovered(roomId);
  }

  invalidateSessionDiscovery(): void {
    this.sessionDiscovery.invalidateSessionDiscovery();
  }

  markNativeSessionUnavailable(provider: string, target: string, nativeSessionId: string): Promise<boolean> {
    return this.availability.markNativeSessionUnavailable(provider, target, nativeSessionId);
  }

  discoverSessions(roomId: string, adapterId?: string): Promise<DiscoveryResult> {
    return this.sessionDiscovery.discoverSessions(roomId, adapterId);
  }

  refreshAvailability(roomId: string): Promise<AgentSummary[]> {
    return this.availability.refreshAvailability(roomId);
  }

  requireRoom(roomId: string): AgentRoom {
    return this.roomDirectory.requireRoom(roomId);
  }

  requireAdapter(adapterId: string): AgentAdapter {
    return this.adapterRegistry.require(adapterId);
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("A2ARuntime.initialize() must be called first");
  }

  private readClock(): number {
    const value = this.dependencies.now();
    if (!Number.isFinite(value)) throw new Error("A2A clock returned an invalid timestamp");
    return value;
  }

  private persist(): Promise<void> { return this.dependencies.persist(); }
  private emit(event: A2ARuntimeEvent): void { this.dependencies.emit(event); }
}
