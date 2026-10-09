import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type {
  A2AAgentPermissionProfileDto,
  A2ATaskRecordDto,
  NativeSession,
} from "../../application/dto/a2a-collaboration.js";
import type { A2APermissionSourceDirectoryPort } from "../ports/a2a-runtime.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

type A2APermissionInheritanceDependencies = {
  directory: A2APermissionSourceDirectoryPort;
  getTask(taskId: string): A2ATaskRecordDto | undefined;
};

/** Resolves and validates caller permissions that an A2A target may inherit. */
export class A2APermissionInheritance {
  constructor(private readonly dependencies: A2APermissionInheritanceDependencies) {}

  async resolveForTask(
    task: TaskAggregate,
    targetSession: NativeSession,
    targetAdapter: AgentAdapter,
  ): Promise<A2AAgentPermissionProfileDto | undefined> {
    const sourceAgentId = task.sourceAgentId?.value;
    if (!sourceAgentId) return undefined;
    if (targetAdapter.permissionHandling === "preserve-target") return undefined;
    const source = this.dependencies.directory.getPermissionSource(sourceAgentId, task.roomId.value);
    if (!source) {
      throw runtimeFault("PERMISSION_DENIED", targetSession.provider, "Could not identify the A2A caller's permissions");
    }
    const sourceAdapter = source.adapter;
    if (!sourceAdapter.getPermissionProfile) {
      throw runtimeFault("PERMISSION_DENIED", source.provider, "The calling agent does not expose an inheritable permission profile");
    }
    const sourceTaskId = task.parentId?.value ?? task.callbackForTaskId?.value;
    const sourceTaskRecord = sourceTaskId ? this.dependencies.getTask(sourceTaskId) : undefined;
    const sourceTask = sourceTaskRecord?.task.targetAgent === source.agentId &&
      (sourceTaskRecord.state === "RUNNING" || sourceTaskRecord.state === "WAITING")
      ? sourceTaskRecord.task
      : undefined;
    const profile = await sourceAdapter.getPermissionProfile(source.session, sourceTask);
    if (!profile || profile.provider !== source.provider) {
      throw runtimeFault("PERMISSION_DENIED", source.provider, "The calling agent's effective permissions could not be determined");
    }
    if (!targetAdapter.canInheritPermissionProfile?.(targetSession, profile)) {
      throw runtimeFault("PERMISSION_DENIED", targetSession.provider, "The target agent cannot safely inherit the caller's permission profile");
    }
    return { ...profile };
  }
}
