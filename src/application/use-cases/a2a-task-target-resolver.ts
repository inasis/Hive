import type { A2ATaskDto, AgentNode, AgentRoom, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { A2AAgentSessionToolRequestDto as AgentSessionToolRequest } from "../dto/a2a-collaboration.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import { A2ANativeSessionProvisioner } from "./a2a-native-session-provisioner.js";
import type { A2AAgentTargetSelection } from "./a2a-agent-target-selection.js";

export type ResolvedNativeCallerTarget = Pick<AgentSessionToolRequest, "targetAgent" | "targetSessionName" | "selector"> & {
  resolvedTargetAgent?: string;
};

type A2ATaskTargetResolverServices = {
  directory: Pick<A2ARuntimeDirectoryPort, "ensureSessionsDiscovered">;
  sessionProvisioner: A2ANativeSessionProvisioner;
  selection: A2AAgentTargetSelection;
};

/** Resolves caller requests to existing agents or provisions a named native session. */
export class A2ATaskTargetResolver {
  constructor(private readonly services: A2ATaskTargetResolverServices) {}

  async resolveNativeCallerTarget(
    source: AgentNode,
    sourceSession: NativeSession,
    room: AgentRoom,
    input: AgentSessionToolRequest,
    visited: string[],
    sourceTask?: A2ATaskDto,
  ): Promise<ResolvedNativeCallerTarget> {
    if (input.selector) return { selector: { ...input.selector } };
    if (!input.targetSessionName && input.targetAgent) {
      const byId = this.services.selection.findRoomAgentById(room, input.targetAgent);
      if (byId) return { targetAgent: byId.agentId, resolvedTargetAgent: byId.agentId };
    }
    const lookupName = input.targetSessionName ?? input.targetAgent;
    let named: AgentNode[] = [];
    if (lookupName) {
      await this.services.directory.ensureSessionsDiscovered(room.roomId);
      named = this.services.selection.sortNativeCallerCandidates(
        this.services.selection.findAgentsBySessionName(room, lookupName),
        source.provider,
        sourceSession.workspace,
      );
      const availableByName = named.find((candidate) => this.services.selection.isEligible(candidate, undefined, visited));
      if (availableByName) return { targetAgent: availableByName.agentId, resolvedTargetAgent: availableByName.agentId };
    }

    if (input.targetAgent) {
      const byId = this.services.selection.findRoomAgentById(room, input.targetAgent);
      if (byId) return { targetAgent: byId.agentId, resolvedTargetAgent: byId.agentId };
    }
    if (named[0]) return { targetAgent: named[0].agentId, resolvedTargetAgent: named[0].agentId };

    const targetKey = input.targetSessionName
      ? `name:${normalizeSessionName(input.targetSessionName)}`
      : `request:${input.targetAgent ?? "unnamed"}`;
    const created = await this.services.sessionProvisioner.provision({
      source,
      sourceSession,
      ...(sourceTask ? { sourceTask } : {}),
      roomId: room.roomId,
      targetKey,
      ...(input.targetSessionName ? { targetSessionName: input.targetSessionName } : {}),
    });
    return { targetAgent: created.agentId, resolvedTargetAgent: created.agentId };
  }
}

function normalizeSessionName(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}
