import type { AgentAggregate } from "../../domain/collaboration/aggregates/agent.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import type { AgentId } from "../../domain/collaboration/value-objects/identifiers.js";

/** Process-local repository for Agent aggregate roots. */
export class InMemoryAgentRepository implements AgentRepository {
  private readonly agents = new Map<string, AgentAggregate>();

  findById(id: AgentId): AgentAggregate | undefined { return this.agents.get(id.value); }
  save(agent: AgentAggregate): void { this.agents.set(agent.id.value, agent); }
}
