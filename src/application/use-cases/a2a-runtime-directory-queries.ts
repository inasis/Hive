import type { AgentNode, AgentSummary, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapter, AgentAdapterDescriptor } from "../ports/a2a-agent-adapter.js";
import type { A2APermissionSource } from "../ports/a2a-runtime.js";
import { copyAgentSummary } from "../validation/a2a-runtime-copy.js";
import { requireNonEmpty } from "../validation/a2a-runtime-validation.js";
import { A2AAdapterRegistry } from "./a2a-adapter-registry.js";
import { A2ARoomDirectory } from "./a2a-room-directory.js";

/** Provides read-only agent, session, and adapter queries for runtime consumers. */
export class A2ARuntimeDirectoryQueries {
  constructor(
    private readonly agents: Map<string, AgentNode>,
    private readonly sessions: Map<string, NativeSession>,
    private readonly adapters: A2AAdapterRegistry,
    private readonly rooms: A2ARoomDirectory,
    private readonly assertInitialized: () => void,
  ) {}

  getSession(agentId: string): NativeSession | undefined {
    return this.sessions.get(agentId);
  }

  getAgentNode(agentId: string): AgentNode | undefined {
    return this.agents.get(agentId);
  }

  listAgentNodes(): AgentNode[] {
    return [...this.agents.values()];
  }

  getAdapter(adapterId: string): AgentAdapter | undefined {
    return this.adapters.adapters.get(adapterId);
  }

  listRoomAgentNodes(roomId: string): AgentNode[] {
    const room = this.rooms.findRoom(roomId);
    if (!room) return [];
    return room.agentIds.flatMap((agentId) => {
      const agent = this.agents.get(agentId);
      return agent ? [agent] : [];
    });
  }

  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  getAgentSummary(agentId: string): AgentSummary | undefined {
    const agent = this.agents.get(agentId);
    return agent ? copyAgentSummary(agent) : undefined;
  }

  getPermissionSource(agentId: string, roomId: string): A2APermissionSource | undefined {
    const agent = this.agents.get(agentId);
    const session = this.sessions.get(agentId);
    const adapter = agent ? this.adapters.adapters.get(agent.adapterId) : undefined;
    if (!agent || !session || !adapter) return undefined;
    if (!this.rooms.requireRoom(roomId).agentIds.includes(agentId)) return undefined;
    return { agentId: agent.agentId, provider: agent.provider, session, adapter };
  }

  listAdapters(): AgentAdapterDescriptor[] {
    return this.adapters.list();
  }

  findAgentForNativeSession(provider: string, nativeSessionId: string): AgentSummary | undefined {
    this.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(nativeSessionId, "nativeSessionId");
    const matches = [...this.agents.values()].filter((agent) => {
      if (agent.provider !== provider) return false;
      const session = this.sessions.get(agent.agentId);
      if (!session) return false;
      const adapter = this.adapters.adapters.get(agent.adapterId);
      return adapter?.matchesNativeSession?.(session, nativeSessionId) ?? session.sessionId === nativeSessionId;
    });
    if (matches.length !== 1) return undefined;
    return copyAgentSummary(matches[0]!);
  }
}
