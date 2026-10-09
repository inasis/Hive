import type { AgentNode, AgentRoom, AgentSummary, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AdapterErrorCode } from "../../domain/a2a-adapter.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { HiveSessionIdentityDto } from "../dto/session-identity.js";
import type { RegisterAgentInput } from "./a2a-runtime-types.js";
import { copyAgentSummary } from "../validation/a2a-runtime-copy.js";
import { isNativeSession, sessionCapabilityError } from "../validation/a2a-agent-validation.js";

type A2ASessionDiscoveryReconcilerServices = {
  agents: ReadonlyMap<string, AgentNode>;
  getSession(agentId: string): NativeSession | undefined;
  setSession(agentId: string, session: NativeSession): void;
  saveAgent(agent: AgentNode): void;
  addAgentToRoom(room: AgentRoom, agentId: string): void;
  touchAgent(agent: AgentNode, timestamp: number): void;
  requireRoom(roomId: string): AgentRoom;
  registerAgent(roomId: string, input: RegisterAgentInput): Promise<AgentNode>;
  sessionIdentityForSession(adapter: AgentAdapter, session: NativeSession): Promise<HiveSessionIdentityDto>;
  createAgentId(): string;
  readClock(): number;
  persist(): Promise<void>;
  emit(event: A2ARuntimeEvent): void;
};

export type A2ASessionDiscoveryReconciliation =
  | { status: "registered"; agent: AgentSummary }
  | { status: "skipped"; code: AdapterErrorCode };

/** Validate discovered provider sessions and reconcile them with registered room agents. */
export class A2ASessionDiscoveryReconciler {
  constructor(private readonly services: A2ASessionDiscoveryReconcilerServices) {}

  async reconcile(
    roomId: string,
    adapter: AgentAdapter,
    discoveredSession: unknown,
  ): Promise<A2ASessionDiscoveryReconciliation> {
    if (!isNativeSession(discoveredSession) || discoveredSession.provider !== adapter.provider) {
      return skipped("UNVERIFIED_INTEGRATION");
    }
    const unsupported = sessionCapabilityError(discoveredSession, adapter);
    if (unsupported) return skipped(unsupported);

    let candidate: NativeSession;
    try {
      const identity = await this.services.sessionIdentityForSession(adapter, discoveredSession);
      candidate = { ...discoveredSession, callerAgentId: identity.hiveSessionId, sessionName: identity.sessionName };
    } catch {
      return skipped("PROVIDER_UNAVAILABLE");
    }

    const existing = [...this.services.agents.values()].find((agent) =>
      agent.adapterId === adapter.adapterId && agent.nativeSessionId === candidate.sessionId,
    );
    if (existing) return this.updateExistingAgent(roomId, existing, candidate);

    const agentId = this.services.createAgentId();
    if (typeof agentId !== "string" || !agentId || this.services.agents.has(agentId)) return skipped("INVALID_REQUEST");
    try {
      const agent = await this.services.registerAgent(roomId, { agentId, adapterId: adapter.adapterId, session: candidate });
      return { status: "registered", agent: copyAgentSummary(agent) };
    } catch {
      return skipped("PROVIDER_UNAVAILABLE");
    }
  }

  private async updateExistingAgent(
    roomId: string,
    existing: AgentNode,
    candidate: NativeSession,
  ): Promise<A2ASessionDiscoveryReconciliation> {
    let profileUpdated = false;
    const existingSession = this.services.getSession(existing.agentId);
    if (candidate.callerAgentId && existing.callerAgentId !== candidate.callerAgentId) {
      existing.callerAgentId = candidate.callerAgentId;
      profileUpdated = true;
    }
    const sessionName = candidate.sessionName?.trim();
    if (sessionName && existing.sessionName !== sessionName) {
      existing.sessionName = sessionName;
      profileUpdated = true;
    }
    if (candidate.workspace && existing.workspace !== candidate.workspace) {
      existing.workspace = candidate.workspace;
      profileUpdated = true;
    }
    if (existingSession && profileUpdated) {
      this.services.setSession(existing.agentId, {
        ...existingSession,
        ...candidate,
        ...(existing.callerAgentId ? { callerAgentId: existing.callerAgentId } : {}),
        ...(sessionName ? { sessionName } : existingSession.sessionName ? { sessionName: existingSession.sessionName } : {}),
        ...(candidate.workspace ? { workspace: candidate.workspace } : existingSession.workspace ? { workspace: existingSession.workspace } : {}),
      });
    }
    if (profileUpdated) this.services.saveAgent(existing);

    const room = this.services.requireRoom(roomId);
    if (!room.agentIds.includes(existing.agentId)) {
      this.services.addAgentToRoom(room, existing.agentId);
      await this.services.persist();
      this.services.emit({ type: "room.updated", room });
    } else if (profileUpdated) {
      this.services.touchAgent(existing, this.services.readClock());
      await this.services.persist();
      this.services.emit({ type: "agent.updated", agent: copyAgentSummary(existing) });
    }
    return { status: "registered", agent: copyAgentSummary(existing) };
  }
}

function skipped(code: AdapterErrorCode): A2ASessionDiscoveryReconciliation {
  return { status: "skipped", code };
}
