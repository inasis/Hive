import type { AgentNode, AgentRoom, AgentSummary, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { HiveSessionIdentityDto } from "../dto/session-identity.js";
import type { DiscoveryResult, RegisterAgentInput } from "./a2a-runtime-types.js";
import { A2ASessionDiscoveryReconciler } from "./a2a-session-discovery-reconciler.js";

const SESSION_DISCOVERY_TTL_MS = 15_000;

type A2ASessionDiscoveryServices = {
  rooms: ReadonlyMap<string, AgentRoom>;
  agents: ReadonlyMap<string, AgentNode>;
  adapters: ReadonlyMap<string, AgentAdapter>;
  getSession(agentId: string): NativeSession | undefined;
  setSession(agentId: string, session: NativeSession): void;
  saveAgent(agent: AgentNode): void;
  addAgentToRoom(room: AgentRoom, agentId: string): void;
  touchAgent(agent: AgentNode, timestamp: number): void;
  requireRoom(roomId: string): AgentRoom;
  requireAdapter(adapterId: string): AgentAdapter;
  registerAgent(roomId: string, input: RegisterAgentInput): Promise<AgentNode>;
  sessionIdentityForSession(adapter: AgentAdapter, session: NativeSession): Promise<HiveSessionIdentityDto>;
  createAgentId(): string;
  assertInitialized(): void;
  readClock(): number;
  persist(): Promise<void>;
  emit(event: A2ARuntimeEvent): void;
};

/** Discover provider sessions and reconcile them with Hive's registered agent directory. */
export class A2ASessionDiscovery {
  private readonly sessionDiscoveryInFlight = new Map<string, Promise<DiscoveryResult>>();
  private readonly sessionDiscoveryAt = new Map<string, number>();
  private readonly sessionDiscoveryGeneration = new Map<string, number>();
  private readonly reconciler: A2ASessionDiscoveryReconciler;

  constructor(private readonly services: A2ASessionDiscoveryServices) {
    this.reconciler = new A2ASessionDiscoveryReconciler({
      agents: services.agents,
      getSession: services.getSession,
      setSession: services.setSession,
      saveAgent: services.saveAgent,
      addAgentToRoom: services.addAgentToRoom,
      touchAgent: services.touchAgent,
      requireRoom: services.requireRoom,
      registerAgent: services.registerAgent,
      sessionIdentityForSession: services.sessionIdentityForSession,
      createAgentId: services.createAgentId,
      readClock: services.readClock,
      persist: services.persist,
      emit: services.emit,
    });
  }

  async ensureSessionsDiscovered(roomId: string): Promise<void> {
    this.services.assertInitialized();
    this.services.requireRoom(roomId);
    while (true) {
      const generation = this.sessionDiscoveryGeneration.get(roomId) ?? 0;
      const lastDiscovery = this.sessionDiscoveryAt.get(roomId);
      const now = this.services.readClock();
      if (lastDiscovery !== undefined && now >= lastDiscovery && now - lastDiscovery < SESSION_DISCOVERY_TTL_MS) return;
      await this.discoverSessions(roomId);
      if (generation === (this.sessionDiscoveryGeneration.get(roomId) ?? 0) && this.sessionDiscoveryAt.has(roomId)) return;
    }
  }

  invalidateSessionDiscovery(): void {
    for (const roomId of this.services.rooms.keys()) {
      this.sessionDiscoveryGeneration.set(roomId, (this.sessionDiscoveryGeneration.get(roomId) ?? 0) + 1);
      this.sessionDiscoveryAt.delete(roomId);
    }
  }

  async discoverSessions(roomId: string, adapterId?: string): Promise<DiscoveryResult> {
    this.services.assertInitialized();
    this.services.requireRoom(roomId);
    const generation = this.sessionDiscoveryGeneration.get(roomId) ?? 0;
    const key = adapterId ? `${roomId}\u0000${adapterId}` : roomId;
    const existing = this.sessionDiscoveryInFlight.get(key);
    if (existing) return existing;
    const discovery = this.discoverSessionsNow(roomId, adapterId);
    this.sessionDiscoveryInFlight.set(key, discovery);
    try {
      const result = await discovery;
      if (!adapterId && generation === (this.sessionDiscoveryGeneration.get(roomId) ?? 0)) {
        this.sessionDiscoveryAt.set(roomId, this.services.readClock());
      }
      return result;
    } finally {
      if (this.sessionDiscoveryInFlight.get(key) === discovery) this.sessionDiscoveryInFlight.delete(key);
    }
  }

  private async discoverSessionsNow(roomId: string, adapterId?: string): Promise<DiscoveryResult> {
    const adapters = adapterId ? [this.services.requireAdapter(adapterId)] : [...this.services.adapters.values()];
    const registered: AgentSummary[] = [];
    const skipped: DiscoveryResult["skipped"] = [];
    for (const adapter of adapters) {
      const descriptor = adapter;
      if (!descriptor.capabilities.discoverSessions || descriptor.integrationStatus === "UNAVAILABLE" ||
          descriptor.integrationStatus === "MANUAL_CONFIGURATION_REQUIRED") {
        skipped.push({ adapterId: descriptor.adapterId, code: "UNVERIFIED_INTEGRATION" });
        continue;
      }
      let sessions: NativeSession[];
      try {
        sessions = await adapter.discoverSessions();
        for (const code of adapter.getDiscoveryFailures?.() ?? []) skipped.push({ adapterId: descriptor.adapterId, code });
      } catch {
        skipped.push({ adapterId: descriptor.adapterId, code: "PROVIDER_UNAVAILABLE" });
        continue;
      }
      for (const discoveredSession of sessions) {
        const result = await this.reconciler.reconcile(roomId, descriptor, discoveredSession);
        if (result.status === "registered") registered.push(result.agent);
        else skipped.push({ adapterId: descriptor.adapterId, code: result.code });
      }
    }
    return { registered, skipped };
  }
}
