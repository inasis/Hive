import type { AgentSummary } from "../../application/dto/a2a-collaboration.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import { requireNonEmpty } from "../validation/a2a-runtime-validation.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import type { A2AAgentStateTransitions } from "./a2a-agent-state-transitions.js";

type A2AAgentAvailabilityDependencies = {
  directory: Pick<A2ARuntimeDirectoryPort, "listAgentNodes" | "getAgentNode" | "getSession" | "getAdapter" | "requireRoom" | "invalidateSessionDiscovery" | "listAgents">;
  stateTransitions: A2AAgentStateTransitions;
  assertInitialized(): void;
  persist(): Promise<void>;
};

/** Checks provider session availability and applies native session lifecycle changes. */
export class A2AAgentAvailability {
  constructor(private readonly dependencies: A2AAgentAvailabilityDependencies) {}

  async markNativeSessionUnavailable(provider: string, target: string, nativeSessionId: string): Promise<boolean> {
    this.dependencies.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(target, "target");
    requireNonEmpty(nativeSessionId, "nativeSessionId");
    const { directory } = this.dependencies;
    let matched = false;
    for (const agent of directory.listAgentNodes()) {
      if (agent.provider !== provider) continue;
      const session = directory.getSession(agent.agentId);
      const adapter = directory.getAdapter(agent.adapterId);
      if (!session || !adapter) continue;
      const matchesTarget = adapter.matchesNativeTarget?.(session, target) ?? true;
      const matchesOwner = adapter.matchesNativeSessionOwner?.(session, nativeSessionId) ?? session.sessionId === nativeSessionId;
      if (!matchesTarget || !matchesOwner) continue;
      matched = true;
      adapter.onNativeSessionDeleted?.(session);
      if (agent.state !== "OFFLINE") this.dependencies.stateTransitions.transition(agent, "OFFLINE", "SESSION_UNAVAILABLE");
    }
    if (!matched) return false;
    directory.invalidateSessionDiscovery();
    await this.dependencies.persist();
    return true;
  }

  async refreshAvailability(roomId: string): Promise<AgentSummary[]> {
    this.dependencies.assertInitialized();
    const { directory } = this.dependencies;
    const room = directory.requireRoom(roomId);
    for (const agentId of room.agentIds) {
      const agent = directory.getAgentNode(agentId);
      if (!agent || agent.state === "WORKING" || agent.state === "WAITING") continue;
      const session = directory.getSession(agentId);
      const adapter = directory.getAdapter(agent.adapterId);
      if (!session) continue;
      if (!adapter) {
        this.dependencies.stateTransitions.transition(agent, "OFFLINE", "ADAPTER_UNAVAILABLE");
        continue;
      }
      try {
        if (!(await adapter.isAvailable(session))) {
          this.dependencies.stateTransitions.transition(agent, "OFFLINE", "SESSION_UNAVAILABLE");
          continue;
        }
        if (await adapter.isBusy?.(session)) {
          if (agent.state === "ERROR") continue;
          if (agent.state === "OFFLINE") this.dependencies.stateTransitions.transition(agent, "IDLE");
          this.dependencies.stateTransitions.transition(agent, "WORKING");
          continue;
        }
        this.dependencies.stateTransitions.transition(agent, "IDLE");
      } catch {
        this.dependencies.stateTransitions.transition(agent, "OFFLINE", "ADAPTER_UNAVAILABLE");
      }
    }
    await this.dependencies.persist();
    return directory.listAgents(roomId);
  }
}
