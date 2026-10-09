import type { AgentNode, AgentSummary } from "../dto/a2a-collaboration.js";
import { AgentAggregate } from "../../domain/collaboration/aggregates/agent.js";
import type { AgentRepository } from "../../domain/collaboration/repositories/agent-repository.js";
import { AgentId } from "../../domain/collaboration/value-objects/identifiers.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import type { AgentProfileUpdate } from "./a2a-runtime-types.js";
import { copyAgentSummary } from "../validation/a2a-runtime-copy.js";
import { requireNonEmpty, uniqueStrings } from "../validation/a2a-runtime-validation.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import { agentAggregateFromNode, applyAgentAggregate } from "../mappers/a2a-agent-mapper.js";

type A2AAgentProfileUpdaterServices = {
  agents: AgentRepository;
  getAgent(agentId: string): AgentNode | undefined;
  readClock(): number;
  persist(): Promise<void>;
  emit(event: A2ARuntimeEvent): void;
};

/** Applies and persists a validated update to an agent's editable profile. */
export class A2AAgentProfileUpdater {
  constructor(private readonly services: A2AAgentProfileUpdaterServices) {}

  async update(agentId: string, update: AgentProfileUpdate): Promise<AgentSummary> {
    const agent = this.services.getAgent(agentId);
    if (!agent) throw runtimeFault("INVALID_REQUEST", "", "Agent does not exist");
    if (update.role !== undefined && update.role !== null) requireNonEmpty(update.role, "role");
    if (update.capabilities !== undefined &&
        (!Array.isArray(update.capabilities) || update.capabilities.some((capability) => typeof capability !== "string" || !capability.trim()))) {
      throw runtimeFault("INVALID_REQUEST", agent.provider, "Agent capabilities must be non-empty strings");
    }
    const aggregate = this.services.agents.findById(new AgentId(agentId)) ?? agentAggregateFromNode(agent);
    aggregate.updateProfile({
      ...(update.role !== undefined ? { role: update.role } : {}),
      ...(update.capabilities !== undefined ? { capabilities: uniqueStrings(update.capabilities) } : {}),
    }, this.services.readClock());
    this.services.agents.save(aggregate);
    applyAgentAggregate(agent, aggregate);
    await this.services.persist();
    this.services.emit({ type: "agent.updated", agent: copyAgentSummary(agent) });
    return copyAgentSummary(agent);
  }
}
