import { isAgentOfflineReason, isAgentState } from "../../domain/collaboration/aggregates/agent.js";
import { isTaskError, isTaskMessageType, isTaskState } from "../../domain/collaboration/aggregates/task.js";
import { isTaskDeliveryValue } from "../../domain/collaboration/value-objects/task-delivery.js";
import type { A2ATaskRecordDto, AgentNode, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { A2ARuntimeSnapshot } from "../../application/dto/a2a-runtime-snapshot.js";

/** Validate persisted JSON without trusting its TypeScript origin. */
export function isA2ARuntimeSnapshot(value: unknown): value is A2ARuntimeSnapshot {
  if (!isRecord(value) || !Array.isArray(value.rooms) || !Array.isArray(value.agents) ||
      !Array.isArray(value.sessions) || !Array.isArray(value.histories) || !Array.isArray(value.tasks)) return false;
  const roomIds = new Set<string>();
  for (const room of value.rooms) {
    if (!isRecord(room) || !nonEmpty(room.roomId) || typeof room.name !== "string" ||
        !Array.isArray(room.agentIds) || room.agentIds.some((id) => typeof id !== "string") ||
        !finiteNumber(room.createdAt) || roomIds.has(room.roomId)) return false;
    roomIds.add(room.roomId);
  }
  const agentIds = new Set<string>();
  for (const agent of value.agents) {
    if (!isRecord(agent) || !nonEmpty(agent.agentId) || !nonEmpty(agent.provider) || !nonEmpty(agent.adapterId) ||
        !nonEmpty(agent.nativeSessionId) || !isAgentState(agent.state) || !Array.isArray(agent.capabilities) ||
        agent.capabilities.some((capability) => typeof capability !== "string") || !finiteNumber(agent.lastActivityAt) ||
        (agent.callerAgentId !== undefined && !nonEmpty(agent.callerAgentId)) ||
        (agent.role !== undefined && typeof agent.role !== "string") ||
        (agent.sessionName !== undefined && typeof agent.sessionName !== "string") ||
        (agent.workspace !== undefined && typeof agent.workspace !== "string") ||
        (agent.currentTaskId !== undefined && typeof agent.currentTaskId !== "string") ||
        (agent.offlineReason !== undefined && !isAgentOfflineReason(agent.offlineReason)) || agentIds.has(agent.agentId)) return false;
    agentIds.add(agent.agentId);
  }
  if (value.communicationPermissions !== undefined) {
    if (!Array.isArray(value.communicationPermissions)) return false;
    const permissionAgentIds = new Set<string>();
    for (const entry of value.communicationPermissions) {
      if (!isRecord(entry) || !nonEmpty(entry.agentId) || !agentIds.has(entry.agentId) ||
          permissionAgentIds.has(entry.agentId) || !isCommunicationPermissions(entry.permissions)) return false;
      permissionAgentIds.add(entry.agentId);
    }
  }
  const sessionAgentIds = new Set<string>();
  for (const entry of value.sessions) {
    if (!isRecord(entry) || !nonEmpty(entry.agentId) || !isNativeSessionValue(entry.session) ||
        !agentIds.has(entry.agentId) || sessionAgentIds.has(entry.agentId)) return false;
    sessionAgentIds.add(entry.agentId);
  }
  if ([...agentIds].some((id) => !sessionAgentIds.has(id))) return false;
  const historyAgentIds = new Set<string>();
  for (const history of value.histories) {
    if (!isRecord(history) || !nonEmpty(history.agentId) || !agentIds.has(history.agentId) || historyAgentIds.has(history.agentId) ||
        !Array.isArray(history.entries) || history.entries.some((entry) =>
          !isRecord(entry) || !nonEmpty(entry.taskId) ||
          (entry.role !== "user" && entry.role !== "assistant") || typeof entry.message !== "string" || !finiteNumber(entry.createdAt))) return false;
    historyAgentIds.add(history.agentId);
  }
  const roomAgents = new Set<string>();
  for (const room of value.rooms) {
    if (room.agentIds.some((id: string) => !agentIds.has(id))) return false;
    for (const id of room.agentIds) roomAgents.add(`${room.roomId}\u0000${id}`);
  }
  const taskIds = new Set<string>();
  const tasks = new Map<string, A2ATaskRecordDto>();
  for (const record of value.tasks) {
    if (!isRecord(record) || !isTaskRecord(record) || !roomIds.has(record.task.roomId) ||
        !agentIds.has(record.task.targetAgent) || taskIds.has(record.task.taskId)) return false;
    taskIds.add(record.task.taskId);
    tasks.set(record.task.taskId, record);
  }
  const callbackTaskIds = new Set<string>();
  for (const record of tasks.values()) {
    const callbackForTaskId = record.task.metadata?.callbackForTaskId;
    if (record.task.metadata?.delivery !== "a2a-result-callback") {
      if (callbackForTaskId !== undefined) return false;
      continue;
    }
    if (typeof callbackForTaskId !== "string" || !nonEmpty(callbackForTaskId) || callbackTaskIds.has(callbackForTaskId)) return false;
    const original = tasks.get(callbackForTaskId);
    if (!original || original.task.sourceAgent === "orchestrator" || original.task.roomId !== record.task.roomId ||
        record.task.targetAgent !== original.task.sourceAgent) return false;
    callbackTaskIds.add(callbackForTaskId);
  }
  for (const record of tasks.values()) {
    const parentTaskId = record.task.parentTaskId;
    if (!parentTaskId) {
      if (record.task.depth !== 0 || record.task.rootTaskId !== record.task.taskId ||
          (record.task.sourceAgent !== "orchestrator" && !roomAgents.has(`${record.task.roomId}\u0000${record.task.sourceAgent}`))) return false;
      continue;
    }
    const parent = tasks.get(parentTaskId);
    if (!parent || parent.task.rootTaskId !== record.task.rootTaskId || parent.task.roomId !== record.task.roomId ||
        parent.task.depth + 1 !== record.task.depth || parent.task.targetAgent !== record.task.sourceAgent ||
        parent.task.visitedAgents.some((agentId, index) => record.task.visitedAgents[index] !== agentId)) return false;
  }
  return true;
}

function isCommunicationPermissions(value: unknown): value is { a2a: boolean; a2b: boolean } {
  return isRecord(value) && typeof value.a2a === "boolean" && typeof value.a2b === "boolean";
}

function isTaskRecord(value: unknown): value is A2ATaskRecordDto {
  if (!isRecord(value)) return false;
  const task = value.task;
  const visitedAgents = isRecord(task) && Array.isArray(task.visitedAgents) ? task.visitedAgents : [];
  const validVisitedPath = isRecord(task) && typeof task.depth === "number" && visitedAgents.length === task.depth + 1;
  const legacyNativeRootVisitedPath = isRecord(task) && task.parentTaskId === undefined && task.depth === 0 &&
    task.sourceAgent !== "orchestrator" && visitedAgents.length === 2 &&
    visitedAgents[0] === task.sourceAgent && visitedAgents[1] === task.targetAgent;
  if (!isRecord(task) || !nonEmpty(task.taskId) || !nonEmpty(task.rootTaskId) || !nonEmpty(task.roomId) ||
      typeof task.sourceAgent !== "string" || !nonEmpty(task.targetAgent) ||
      !isTaskMessageType(task.type) ||
      typeof task.message !== "string" || typeof task.depth !== "number" || !Number.isSafeInteger(task.depth) || task.depth < 0 ||
      typeof task.maxDepth !== "number" || !Number.isSafeInteger(task.maxDepth) || task.maxDepth < task.depth || task.maxDepth > 64 ||
      typeof task.timeoutMs !== "number" || !Number.isSafeInteger(task.timeoutMs) || task.timeoutMs < 0 || !finiteNumber(task.createdAt) ||
      !Array.isArray(task.visitedAgents) || task.visitedAgents.some((agentId) => typeof agentId !== "string") ||
      (!validVisitedPath && !legacyNativeRootVisitedPath) || task.visitedAgents.at(-1) !== task.targetAgent ||
      (task.parentTaskId !== undefined && typeof task.parentTaskId !== "string") ||
      (isRecord(task.metadata) && task.metadata.delivery !== undefined && !isTaskDeliveryValue(task.metadata.delivery)) ||
      (isRecord(task.metadata) && task.metadata.a2aFlowId !== undefined &&
        (typeof task.metadata.a2aFlowId !== "string" || task.metadata.a2aFlowId.trim().length === 0)) ||
      (isRecord(task.metadata) && task.metadata.a2aFlowDepth !== undefined &&
        (typeof task.metadata.a2aFlowDepth !== "number" || !Number.isSafeInteger(task.metadata.a2aFlowDepth) ||
          task.metadata.a2aFlowDepth < 0 || task.metadata.a2aFlowDepth > task.maxDepth)) ||
      (isRecord(task.metadata) && task.metadata.callbackForTaskId !== undefined &&
        (task.metadata.delivery !== "a2a-result-callback" || !nonEmpty(task.metadata.callbackForTaskId) ||
          task.parentTaskId !== undefined || task.depth !== 0)) ||
      (isRecord(task.metadata) && task.metadata.delivery === "a2a-result-callback" &&
        !nonEmpty(task.metadata.callbackForTaskId)) ||
      (isRecord(task.metadata) && task.metadata.responseForTaskId !== undefined &&
        (task.metadata.delivery !== "a2a-result-delivery" || !nonEmpty(task.metadata.responseForTaskId) ||
          task.parentTaskId !== task.metadata.responseForTaskId)) ||
      (isRecord(task.metadata) && task.metadata.delivery === "a2a-result-delivery" &&
        !nonEmpty(task.metadata.responseForTaskId)) ||
      (isRecord(task.metadata) && task.metadata.callbackForTaskId !== undefined &&
        task.metadata.responseForTaskId !== undefined) ||
      (task.metadata !== undefined && !isRecord(task.metadata))) return false;
  if (!isTaskState(value.state) || !finiteNumber(value.updatedAt)) return false;
  if (value.result !== undefined) {
    const result = value.result;
    if (!isRecord(result) || result.taskId !== task.taskId || result.agentId !== task.targetAgent ||
        typeof result.message !== "string" ||
        (result.status !== "COMPLETED" && result.status !== "FAILED" && result.status !== "CANCELLED" && result.status !== "TIMED_OUT") ||
        (result.artifacts !== undefined && (!Array.isArray(result.artifacts) || result.artifacts.some((item) =>
          !isRecord(item) || typeof item.name !== "string" || (item.uri !== undefined && typeof item.uri !== "string") ||
          (item.description !== undefined && typeof item.description !== "string")))) ||
        (result.metadata !== undefined && !isRecord(result.metadata))) return false;
    if (value.state !== result.status) return false;
  } else if (value.state === "COMPLETED") {
    return false;
  }
  if (value.error !== undefined && !isTaskError(value.error)) return false;
  return true;
}

function isNativeSessionValue(value: unknown): value is NativeSession {
  if (!isRecord(value)) return false;
  return nonEmpty(value.sessionId) && nonEmpty(value.provider) &&
    (value.callerAgentId === undefined || nonEmpty(value.callerAgentId)) &&
    (value.sessionName === undefined || typeof value.sessionName === "string") &&
    (value.workspace === undefined || typeof value.workspace === "string") &&
    (value.persistenceLevel === 0 || value.persistenceLevel === 1 || value.persistenceLevel === 2 || value.persistenceLevel === 3) &&
    typeof value.runtimeManagedHistory === "boolean" && (value.persistenceLevel !== 1 || value.runtimeManagedHistory);
}

/** Validate cross-record invariants after the snapshot has passed structural validation. */
export function validateA2ARuntimeSnapshotRelations(snapshot: A2ARuntimeSnapshot): void {
  const sessions = new Map(snapshot.sessions.map(({ agentId, session }) => [agentId, session]));
  for (const agent of snapshot.agents) {
    const session = sessions.get(agent.agentId);
    if (!session || session.sessionId !== agent.nativeSessionId || session.provider !== agent.provider ||
        (agent.callerAgentId !== undefined && session.callerAgentId !== undefined && agent.callerAgentId !== session.callerAgentId)) {
      throw new Error("A2A runtime agent and native session mappings do not match");
    }
  }
  for (const { agentId } of snapshot.histories) {
    const session = sessions.get(agentId);
    if (!session || session.persistenceLevel !== 1 || !session.runtimeManagedHistory) {
      throw new Error("A2A runtime history is attached to a session without runtime-managed history");
    }
  }
  const roomMemberships = new Set<string>();
  for (const room of snapshot.rooms) {
    for (const agentId of room.agentIds) {
      const key = `${room.roomId}\u0000${agentId}`;
      if (roomMemberships.has(key)) throw new Error("A2A room contains a duplicate agent");
      roomMemberships.add(key);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
