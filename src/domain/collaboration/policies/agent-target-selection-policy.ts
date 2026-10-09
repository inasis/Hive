import type { AgentAggregate } from "../aggregates/agent.js";
import type { AgentSelector, RoutingPolicy } from "../aggregates/task.js";

export type AgentTargetCandidate = {
  agent: AgentAggregate;
  provider: string;
  workspace?: string;
  available: boolean;
  experimental: boolean;
  supportsResume: boolean;
  supportsStructuredOutput: boolean;
  supportsCancellation: boolean;
  supportsConcurrentTasks: boolean;
  canAttachExistingProcess: boolean;
  persistenceLevel: 0 | 1 | 2 | 3;
  canDelegate: boolean;
  queueLoad: number;
};

/** Domain decisions for eligible collaboration targets and their routing order. */
export class AgentTargetSelectionPolicy {
  static isEligible(
    candidate: AgentTargetCandidate,
    selector: AgentSelector | undefined,
    visitedAgentIds: readonly string[],
    policy: RoutingPolicy,
  ): boolean {
    const agentId = candidate.agent.id.value;
    if (visitedAgentIds.includes(agentId) || !candidate.available) return false;
    if (selector?.role && candidate.agent.role !== selector.role) return false;
    if (selector?.provider && candidate.provider !== selector.provider) return false;
    if (selector?.workspace && candidate.workspace !== selector.workspace) return false;
    if (selector?.capabilities?.some((capability) => !candidate.agent.capabilities.includes(capability))) return false;
    if (candidate.experimental && !policy.allowExperimentalAdapters) return false;
    if (policy.requireResumeCapability && !candidate.supportsResume) return false;
    if (policy.requireStructuredOutput && !candidate.supportsStructuredOutput) return false;
    if (policy.requireCancellation && !candidate.supportsCancellation) return false;
    if (candidate.persistenceLevel === 2 && !candidate.supportsResume) return false;
    if (candidate.persistenceLevel === 3 && !candidate.canAttachExistingProcess) return false;
    return candidate.agent.canAcceptTask({
      concurrentExecutionSupported: candidate.supportsConcurrentTasks,
      queueingAllowed: policy.allowQueueing,
    });
  }

  static canDeliverResponse(candidate: AgentTargetCandidate): boolean {
    return candidate.canDelegate;
  }

  static compare(
    left: AgentTargetCandidate,
    right: AgentTargetCandidate,
    selector: AgentSelector | undefined,
  ): number {
    const leftStateRank = left.agent.state === "IDLE" ? 0 : 1;
    const rightStateRank = right.agent.state === "IDLE" ? 0 : 1;
    const leftWorkspaceRank = selector?.workspace && left.workspace === selector.workspace ? 0 : 1;
    const rightWorkspaceRank = selector?.workspace && right.workspace === selector.workspace ? 0 : 1;
    return left.queueLoad - right.queueLoad || leftStateRank - rightStateRank || leftWorkspaceRank - rightWorkspaceRank ||
      left.agent.lastActivityAt - right.agent.lastActivityAt || left.agent.id.value.localeCompare(right.agent.id.value);
  }

  static compareNativeCallerCandidates(
    left: AgentTargetCandidate,
    right: AgentTargetCandidate,
    sourceProvider: string,
    sourceWorkspace: string | undefined,
  ): number {
    const leftPreference = Number(left.provider !== sourceProvider) + Number(left.workspace !== sourceWorkspace);
    const rightPreference = Number(right.provider !== sourceProvider) + Number(right.workspace !== sourceWorkspace);
    return leftPreference - rightPreference || left.queueLoad - right.queueLoad ||
      left.agent.lastActivityAt - right.agent.lastActivityAt || left.agent.id.value.localeCompare(right.agent.id.value);
  }
}
