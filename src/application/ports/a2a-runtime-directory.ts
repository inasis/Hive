import type { AgentNode, AgentRoom, AgentSummary, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapter } from "./a2a-agent-adapter.js";

/** Application-owned lookup contract for A2A runtime directory consumers. */
export interface A2ARuntimeDirectoryPort {
  findAgentForNativeSession(provider: string, nativeSessionId: string): AgentSummary | undefined;
  getAgentNode(agentId: string): AgentNode | undefined;
  listAgentNodes(): AgentNode[];
  getSession(agentId: string): NativeSession | undefined;
  getAdapter(adapterId: string): AgentAdapter | undefined;
  requireAdapter(adapterId: string): AgentAdapter;
  requireRoom(roomId: string): AgentRoom;
  getRoomForAgent(agentId: string): AgentRoom | undefined;
  listRoomAgentNodes(roomId: string): AgentNode[];
  listRooms(): AgentRoom[];
  ensureSessionsDiscovered(roomId: string): Promise<void>;
  invalidateSessionDiscovery(): void;
  listAgents(roomId: string): AgentSummary[];
}

/** Directory mutation required to keep the current task pointer synchronized with task activity. */
export interface A2AAgentActivityDirectoryPort {
  setCurrentTaskId(agentId: string, taskId: string | undefined): void;
}

/** Agent registration operations used when task routing provisions a native session. */
export interface A2ANativeSessionProvisioningDirectoryPort {
  hasAgent(agentId: string): boolean;
  registerAgent(roomId: string, input: { agentId: string; adapterId: string; session: NativeSession }): Promise<AgentNode>;
}
