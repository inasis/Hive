import type { AgentAggregate } from "../aggregates/agent.js";
import type { AgentId } from "../value-objects/identifiers.js";

/** Loads and stores one Agent aggregate by its root identity. */
export interface AgentRepository {
  findById(id: AgentId): AgentAggregate | undefined;
  save(agent: AgentAggregate): void;
}
