import { AgentId } from "./identifiers.js";

abstract class NonNegativeInteger {
  protected constructor(readonly value: number, label: string) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }
}

export class TaskDepth extends NonNegativeInteger {
  constructor(value: number) { super(value, "Task depth"); }

  equals(other: TaskDepth): boolean {
    return this.value === other.value;
  }

  next(): TaskDepth {
    return new TaskDepth(this.value + 1);
  }
}

export class FlowDepth extends NonNegativeInteger {
  constructor(value: number) { super(value, "Flow depth"); }

  equals(other: FlowDepth): boolean {
    return this.value === other.value;
  }

  next(): FlowDepth {
    return new FlowDepth(this.value + 1);
  }
}

/** Ordered task ancestry. Repeated agents are valid and remain in the path. */
export class AgentPath {
  private readonly path: readonly AgentId[];

  constructor(agentIds: readonly string[]) {
    this.path = agentIds.map((agentId) => new AgentId(agentId));
  }

  get agentIds(): string[] {
    return this.path.map((agentId) => agentId.value);
  }

  get length(): number {
    return this.path.length;
  }

  last(): AgentId | undefined {
    return this.path.at(-1);
  }

  startsWith(parent: AgentPath): boolean {
    return parent.path.every((agentId, index) => this.path[index]?.equals(agentId));
  }

  equals(other: AgentPath): boolean {
    return this.path.length === other.path.length && this.path.every((agentId, index) => {
      const otherAgentId = other.path[index];
      return otherAgentId !== undefined && agentId.equals(otherAgentId);
    });
  }

  append(agentId: AgentId): AgentPath {
    return new AgentPath([...this.agentIds, agentId.value]);
  }
}
