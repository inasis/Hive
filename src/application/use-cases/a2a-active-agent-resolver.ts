import type { A2ATaskAncestryDto, A2ATaskRecordDto, AgentSummary } from "../../application/dto/a2a-collaboration.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import type { A2AAgentActivity } from "./a2a-agent-activity.js";
import { copyAgentSummary } from "../validation/a2a-runtime-copy.js";
import { requireNonEmpty } from "../validation/a2a-runtime-validation.js";

type A2AActiveAgentResolverDependencies = {
  directory: Pick<A2ARuntimeDirectoryPort, "listAgentNodes" | "getAgentNode" | "getSession" | "getAdapter" | "listRooms" | "ensureSessionsDiscovered">;
  activity: A2AAgentActivity;
  getTask(taskId: string): A2ATaskRecordDto | undefined;
  hasPendingRequest(agentId: string): boolean;
  assertInitialized(): void;
};

/** Resolves an unambiguous active Hive agent from native provider session identity. */
export class A2AActiveAgentResolver {
  constructor(private readonly dependencies: A2AActiveAgentResolverDependencies) {}

  async findForTarget(provider: string, target: string): Promise<AgentSummary | undefined> {
    this.dependencies.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(target, "target");
    const { directory, activity } = this.dependencies;
    const matches = [];
    for (const agent of directory.listAgentNodes()) {
      if (agent.provider !== provider) continue;
      const session = directory.getSession(agent.agentId);
      const adapter = directory.getAdapter(agent.adapterId);
      if (!session || !adapter || (adapter.matchesNativeTarget && !adapter.matchesNativeTarget(session, target))) continue;
      const hasActiveRuntimeTask = activity.activeTaskIds(agent.agentId).some((taskId) => {
        const task = this.dependencies.getTask(taskId);
        return task?.state === "RUNNING" || task?.state === "WAITING";
      });
      if (hasActiveRuntimeTask) {
        matches.push(agent);
        continue;
      }
      if (this.dependencies.hasPendingRequest(agent.agentId) || !adapter.isBusy) continue;
      if (await adapter.isBusy(session)) matches.push(agent);
    }
    if (matches.length !== 1) return undefined;
    return copyAgentSummary(matches[0]!);
  }

  async resolveForTarget(provider: string, target: string): Promise<AgentSummary | undefined> {
    let agent = await this.findForTarget(provider, target);
    if (agent) return agent;
    for (const room of this.dependencies.directory.listRooms()) {
      await this.dependencies.directory.ensureSessionsDiscovered(room.roomId);
      agent = await this.findForTarget(provider, target);
      if (agent) return agent;
    }
    return undefined;
  }

  async resolveForTask(provider: string, callerAgentId: string, nativeSessionId?: string): Promise<AgentSummary | undefined> {
    this.dependencies.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(callerAgentId, "callerAgentId");
    const { directory, activity } = this.dependencies;
    const directAgent = directory.getAgentNode(callerAgentId);
    const matches = directAgent ? [directAgent] : directory.listAgentNodes().filter((candidate) => candidate.callerAgentId === callerAgentId);
    if (matches.length !== 1) return undefined;
    const agent = matches[0]!;
    const session = directory.getSession(agent.agentId);
    const adapter = directory.getAdapter(agent.adapterId);
    if (!agent || agent.provider !== provider || !session || !adapter) return undefined;
    const activeTasks = activity.activeTaskIds(agent.agentId).filter((taskId) => {
      const task = this.dependencies.getTask(taskId);
      return task?.state === "RUNNING" || task?.state === "WAITING";
    });
    if (nativeSessionId) {
      if (!(adapter.matchesNativeSession?.(session, nativeSessionId) ?? session.sessionId === nativeSessionId)) return undefined;
      const taskId = adapter.getActiveTaskIdForSession?.(session, nativeSessionId);
      if (taskId ? !activeTasks.includes(taskId) : activeTasks.length !== 1) return undefined;
    } else if (activeTasks.length !== 1) return undefined;
    return copyAgentSummary(agent);
  }

  findActiveParentTaskAncestry(agentId: string, nativeSessionId?: string): A2ATaskAncestryDto | undefined {
    const { directory, activity } = this.dependencies;
    const agent = directory.getAgentNode(agentId);
    const session = directory.getSession(agentId);
    const adapter = agent ? directory.getAdapter(agent.adapterId) : undefined;
    if (nativeSessionId && session && adapter?.getActiveTaskIdForSession) {
      const taskId = adapter.getActiveTaskIdForSession(session, nativeSessionId);
      const task = taskId ? this.dependencies.getTask(taskId) : undefined;
      return task && (task.state === "RUNNING" || task.state === "WAITING")
        ? taskAncestry(agentId, task)
        : undefined;
    }
    const candidates = activity.activeTaskIds(agentId)
      .map((taskId) => this.dependencies.getTask(taskId))
      .filter((task): task is A2ATaskRecordDto => task !== undefined && (task.state === "RUNNING" || task.state === "WAITING"));
    const task = candidates.length === 1 ? candidates[0] : undefined;
    return task ? taskAncestry(agentId, task) : undefined;
  }
}

function taskAncestry(agentId: string, task: A2ATaskRecordDto): A2ATaskAncestryDto {
  return {
    sourceAgentId: agentId,
    parentTaskId: task.task.taskId,
    flowParentTaskId: task.task.taskId,
  };
}
