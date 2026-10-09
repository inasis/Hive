import type { AgentNode } from "../dto/a2a-collaboration.js";
import { AgentAggregate } from "../../domain/collaboration/aggregates/agent.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import { AgentId } from "../../domain/collaboration/value-objects/identifiers.js";
import { agentAggregateFromNode, applyAgentAggregate } from "../mappers/a2a-agent-mapper.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import { copyAgentSummary } from "../validation/a2a-runtime-copy.js";

type A2AAgentStateTransitionsServices = {
  agents: AgentRepository;
  now(): number;
  emit(event: A2ARuntimeEvent): void;
};

/** Applies the shared agent state transition, activity timestamp, and event policy. */
export class A2AAgentStateTransitions {
  constructor(private readonly services: A2AAgentStateTransitionsServices) {}

  transition(agent: AgentNode, next: AgentNode["state"], offlineReason?: AgentNode["offlineReason"]): void {
    const timestamp = this.services.now();
    if (!Number.isFinite(timestamp)) throw new Error("A2A clock returned an invalid timestamp");
    const aggregate = this.services.agents.findById(new AgentId(agent.agentId)) ?? agentAggregateFromNode(agent);
    aggregate.transition(next, timestamp, offlineReason);
    this.services.agents.save(aggregate);
    applyAgentAggregate(agent, aggregate);
    this.services.emit({ type: "agent.updated", agent: copyAgentSummary(agent) });
  }

  touch(agent: AgentNode, timestamp: number): void {
    const aggregate = this.services.agents.findById(new AgentId(agent.agentId)) ?? agentAggregateFromNode(agent);
    aggregate.touch(timestamp);
    this.services.agents.save(aggregate);
    applyAgentAggregate(agent, aggregate);
  }
}
