import type { AgentNode } from "../../application/dto/a2a-collaboration.js";
import type { A2AAgentActivityDirectoryPort } from "../ports/a2a-runtime-directory.js";
import type { A2AAgentStateTransitions } from "./a2a-agent-state-transitions.js";

/** Track running and waiting tasks and keep each agent's displayed state in sync. */
export class A2AAgentActivity {
  private readonly activeTasks = new Map<string, Set<string>>();
  private readonly waitingTasks = new Map<string, Set<string>>();

  constructor(
    private readonly directory: A2AAgentActivityDirectoryPort,
    private readonly stateTransitions: A2AAgentStateTransitions,
  ) {}

  activeTaskIds(agentId: string): string[] {
    return [...(this.activeTasks.get(agentId) ?? [])];
  }

  activeTaskCount(agentId: string): number {
    return this.activeTasks.get(agentId)?.size ?? 0;
  }

  addActive(agentId: string, taskId: string): void {
    const active = this.activeTasks.get(agentId) ?? new Set<string>();
    active.add(taskId);
    this.activeTasks.set(agentId, active);
    this.refreshCurrentTaskId(agentId);
  }

  removeActive(agentId: string, taskId: string): void {
    const active = this.activeTasks.get(agentId);
    active?.delete(taskId);
    if (active?.size === 0) this.activeTasks.delete(agentId);
    this.refreshCurrentTaskId(agentId);
  }

  addWaiting(agentId: string, taskId: string): void {
    const waiting = this.waitingTasks.get(agentId) ?? new Set<string>();
    waiting.add(taskId);
    this.waitingTasks.set(agentId, waiting);
  }

  removeWaiting(agentId: string, taskId: string): void {
    const waiting = this.waitingTasks.get(agentId);
    waiting?.delete(taskId);
    if (waiting?.size === 0) this.waitingTasks.delete(agentId);
  }

  refreshAgentState(agent: AgentNode): void {
    const active = this.activeTasks.get(agent.agentId);
    const waiting = this.waitingTasks.get(agent.agentId);
    if (!active || active.size === 0) {
      if (agent.state !== "OFFLINE" && agent.state !== "ERROR") this.stateTransitions.transition(agent, "IDLE");
      this.directory.setCurrentTaskId(agent.agentId, undefined);
      return;
    }
    const currentTaskId = active.values().next().value;
    if (currentTaskId) this.directory.setCurrentTaskId(agent.agentId, currentTaskId);
    const next = waiting && waiting.size >= active.size ? "WAITING" : "WORKING";
    if (agent.state !== next) this.stateTransitions.transition(agent, next);
  }

  private refreshCurrentTaskId(agentId: string): void {
    const first = this.activeTasks.get(agentId)?.values().next().value;
    this.directory.setCurrentTaskId(agentId, first);
  }
}
