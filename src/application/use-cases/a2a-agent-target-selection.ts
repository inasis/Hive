import type { A2AAgentSelectorDto, AgentNode, AgentRoom } from "../../application/dto/a2a-collaboration.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import { AgentId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { RoutingPolicy } from "../../domain/collaboration/aggregates/task.js";
import { AgentTargetSelectionPolicy, type AgentTargetCandidate } from "../../domain/collaboration/policies/agent-target-selection-policy.js";
import { toDomainAgentSelector } from "../mappers/a2a-collaboration-mapper.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

type A2AAgentTargetSelectionServices = {
  directory: Pick<A2ARuntimeDirectoryPort, "getAgentNode" | "getSession" | "getAdapter" | "listRoomAgentNodes">;
  agents: AgentRepository;
  policy: RoutingPolicy;
  agentLoad(agentId: string): number;
};

/** Select registered task targets using room membership, capability, and load policy. */
export class A2AAgentTargetSelection {
  constructor(private readonly services: A2AAgentTargetSelectionServices) {}

  findRoomAgentById(room: AgentRoom, identifier: string): AgentNode | undefined {
    const direct = this.services.directory.getAgentNode(identifier);
    if (direct && room.agentIds.includes(direct.agentId)) return direct;
    const matches = this.services.directory.listRoomAgentNodes(room.roomId)
      .filter((agent) => agent.callerAgentId === identifier);
    return matches.length === 1 ? matches[0] : undefined;
  }

  findAgentsBySessionName(room: AgentRoom, sessionName: string): AgentNode[] {
    const key = normalizeSessionName(sessionName);
    if (!key) return [];
    return this.services.directory.listRoomAgentNodes(room.roomId)
      .filter((agent) => normalizeSessionName(agent.sessionName ?? "") === key)
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
  }

  sortNativeCallerCandidates(candidates: readonly AgentNode[], sourceProvider: string, sourceWorkspace: string | undefined): AgentNode[] {
    return [...candidates].sort((left, right) => {
      const leftCandidate = this.routingCandidate(left);
      const rightCandidate = this.routingCandidate(right);
      if (leftCandidate && rightCandidate) {
        return AgentTargetSelectionPolicy.compareNativeCallerCandidates(
          leftCandidate,
          rightCandidate,
          sourceProvider,
          sourceWorkspace,
        );
      }
      const leftPreference = Number(left.provider !== sourceProvider) + Number(left.workspace !== sourceWorkspace);
      const rightPreference = Number(right.provider !== sourceProvider) + Number(right.workspace !== sourceWorkspace);
      return leftPreference - rightPreference || this.services.agentLoad(left.agentId) - this.services.agentLoad(right.agentId) ||
        left.lastActivityAt - right.lastActivityAt || left.agentId.localeCompare(right.agentId);
    });
  }

  isEligible(agent: AgentNode, selector: A2AAgentSelectorDto | undefined, visited: string[], requiresResponseDelivery = false): boolean {
    const candidate = this.routingCandidate(agent);
    const domainSelector = selector ? toDomainAgentSelector(selector) : undefined;
    return candidate !== undefined && AgentTargetSelectionPolicy.isEligible(candidate, domainSelector, visited, this.services.policy) &&
      (!requiresResponseDelivery || AgentTargetSelectionPolicy.canDeliverResponse(candidate));
  }

  private routingCandidate(agent: AgentNode): AgentTargetCandidate | undefined {
    const adapter = this.services.directory.getAdapter(agent.adapterId);
    const session = this.services.directory.getSession(agent.agentId);
    const agentAggregate = this.services.agents.findById(new AgentId(agent.agentId));
    if (!adapter || !session || !agentAggregate) return undefined;
    return {
      agent: agentAggregate,
      provider: agent.provider,
      ...(agent.workspace !== undefined ? { workspace: agent.workspace } : {}),
      available: adapter.integrationStatus !== "UNAVAILABLE" && adapter.integrationStatus !== "MANUAL_CONFIGURATION_REQUIRED" &&
        adapter.evidence.source !== "unsupported",
      experimental: adapter.integrationStatus === "EXPERIMENTAL",
      supportsResume: adapter.capabilities.resumeSession,
      supportsStructuredOutput: adapter.capabilities.structuredOutput,
      supportsCancellation: adapter.capabilities.cancellation,
      supportsConcurrentTasks: adapter.capabilities.concurrentTasks,
      canAttachExistingProcess: adapter.capabilities.attachExistingProcess,
      persistenceLevel: session.persistenceLevel,
      canDelegate: Boolean(adapter.capabilities.delegation && (adapter.canDelegate?.(session) ?? true)),
      queueLoad: this.services.agentLoad(agent.agentId),
    };
  }

  selectAgent(
    room: AgentRoom,
    targetSessionName: string | undefined,
    targetAgent: string | undefined,
    selector: A2AAgentSelectorDto | undefined,
    visited: string[],
    requiresResponseDelivery: boolean,
  ): AgentNode {
    const requestedName = targetSessionName ?? targetAgent;
    if (requestedName) {
      const named = this.findAgentsBySessionName(room, requestedName);
      const eligibleNamed = named.find((agent) => this.isEligible(agent, selector, visited, requiresResponseDelivery));
      if (eligibleNamed) return eligibleNamed;
      if (targetAgent) {
        if (visited.includes(targetAgent)) throw runtimeFault("CYCLE_DETECTED", "", "Delegation would revisit an agent");
        const byId = this.findRoomAgentById(room, targetAgent);
        if (byId) {
          if (visited.includes(byId.agentId)) throw runtimeFault("CYCLE_DETECTED", byId.provider, "Delegation would revisit an agent");
          if (!this.isEligible(byId, selector, visited, requiresResponseDelivery)) {
            throw runtimeFault("NO_AGENT_AVAILABLE", byId.provider, "Target agent is not available for this task");
          }
          return byId;
        }
      }
      if (named[0]) {
        if (visited.includes(named[0].agentId)) throw runtimeFault("CYCLE_DETECTED", named[0].provider, "Delegation would revisit an agent");
        throw runtimeFault("NO_AGENT_AVAILABLE", named[0].provider, "The named session is not available for this task");
      }
      throw runtimeFault("NO_AGENT_AVAILABLE", "", "No session matches the requested name or agent ID");
    }

    const domainSelector = selector ? toDomainAgentSelector(selector) : undefined;
    const eligible = this.services.directory.listRoomAgentNodes(room.roomId).flatMap((node) => {
      const candidate = this.routingCandidate(node);
      if (!candidate || !AgentTargetSelectionPolicy.isEligible(candidate, domainSelector, visited, this.services.policy) ||
          (requiresResponseDelivery && !AgentTargetSelectionPolicy.canDeliverResponse(candidate))) return [];
      return [{ node, candidate }];
    });
    eligible.sort((left, right) => AgentTargetSelectionPolicy.compare(left.candidate, right.candidate, domainSelector));
    const selected = eligible[0]?.node;
    if (!selected) throw runtimeFault("NO_AGENT_AVAILABLE", "", "No available agent matches the requested role and capabilities");
    return selected;
  }

  selectResolvedAgent(
    room: AgentRoom,
    agentId: string,
    selector: A2AAgentSelectorDto | undefined,
    visited: string[],
    requiresResponseDelivery: boolean,
  ): AgentNode {
    if (visited.includes(agentId)) throw runtimeFault("CYCLE_DETECTED", "", "Delegation would revisit an agent");
    const agent = this.services.directory.getAgentNode(agentId);
    if (!agent || !room.agentIds.includes(agentId) || !this.isEligible(agent, selector, visited, requiresResponseDelivery)) {
      throw runtimeFault("NO_AGENT_AVAILABLE", agent?.provider ?? "", "Resolved target agent is not available for this task");
    }
    return agent;
  }
}

function normalizeSessionName(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}
