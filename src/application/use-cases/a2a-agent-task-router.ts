import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import { TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import type {
  A2ACommunicationPermissionsDto,
  A2ATaskAncestryDto,
  A2ATaskRecordDto,
  A2AAgentSessionToolRequestDto as AgentSessionToolRequest,
} from "../dto/a2a-collaboration.js";
import { toA2ATaskDto } from "../mappers/a2a-collaboration-mapper.js";
import { requireNonEmpty } from "../validation/a2a-runtime-validation.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import { A2AAgentTaskDeliveryPolicy } from "./a2a-agent-task-delivery-policy.js";
import type { A2AActiveAgentResolver } from "./a2a-active-agent-resolver.js";
import type { A2ANativeSessionAgentResolver } from "./a2a-native-session-agent-resolver.js";
import type { A2AAgentTargetSelection } from "./a2a-agent-target-selection.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import type { A2ATaskScheduler } from "./a2a-task-scheduler.js";
import { isA2AFlowTask, resolveA2AFlowId } from "./a2a-task-flow-lineage.js";
import type { A2ATaskTargetResolver } from "./a2a-task-target-resolver.js";

type A2AAgentTaskRouterDependencies = {
  directory: Pick<A2ARuntimeDirectoryPort, "getAgentNode" | "requireAdapter" | "getSession" | "getRoomForAgent">;
  nativeSessionAgentResolver: A2ANativeSessionAgentResolver;
  tasks: TaskRepository;
  abortControllers: Map<string, AbortController>;
  activeAgentResolver: A2AActiveAgentResolver;
  targetSelection: A2AAgentTargetSelection;
  targetResolver: A2ATaskTargetResolver;
  scheduler: A2ATaskScheduler;
  cancelTask(taskId: string): Promise<void>;
  trackPendingAsyncRequest(agentId: string): () => void;
  getCommunicationPermissions(agentId: string): A2ACommunicationPermissionsDto | undefined;
  assertInitialized(): void;
};

/** Validates agent-originated A2A/A2B sends and converts them into scheduled tasks. */
export class A2AAgentTaskRouter {
  private readonly deliveryPolicy: A2AAgentTaskDeliveryPolicy;

  constructor(private readonly dependencies: A2AAgentTaskRouterDependencies) {
    this.deliveryPolicy = new A2AAgentTaskDeliveryPolicy({
      tasks: dependencies.tasks,
      findRoomAgentById: (room, identifier) => dependencies.targetSelection.findRoomAgentById(room, identifier),
      isA2AFlowTask,
      flowIdForTask: (task) => resolveA2AFlowId(task, dependencies.tasks),
    });
  }

  async sendFromNativeSession(provider: string, nativeSessionId: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    this.dependencies.assertInitialized();
    const source = await this.dependencies.nativeSessionAgentResolver.resolve(provider, nativeSessionId);
    if (!source) throw runtimeFault("SESSION_NOT_FOUND", provider, "Calling native session is not registered in a Hive room");
    const ancestry = this.dependencies.activeAgentResolver.findActiveParentTaskAncestry(source.agentId, nativeSessionId);
    return this.sendFromAgentWithAncestry(source.agentId, input, ancestry ?? { sourceAgentId: source.agentId });
  }

  async sendFromActiveSession(provider: string, target: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    this.dependencies.assertInitialized();
    requireNonEmpty(provider, "provider");
    requireNonEmpty(target, "target");
    const source = await this.dependencies.activeAgentResolver.findForTarget(provider, target);
    if (!source) {
      throw runtimeFault("INVALID_REQUEST", provider, "Could not uniquely identify the active session for this provider target");
    }
    const ancestry = this.dependencies.activeAgentResolver.findActiveParentTaskAncestry(source.agentId);
    return this.sendFromAgentWithAncestry(source.agentId, input, ancestry ?? { sourceAgentId: source.agentId });
  }

  async sendFromAgent(agentId: string, input: AgentSessionToolRequest): Promise<A2ATaskRecordDto> {
    const ancestry = this.dependencies.activeAgentResolver.findActiveParentTaskAncestry(agentId);
    return this.sendFromAgentWithAncestry(agentId, input, ancestry ?? { sourceAgentId: agentId });
  }

  async sendFromAgentWithAncestry(
    agentId: string,
    input: AgentSessionToolRequest,
    ancestry: A2ATaskAncestryDto,
  ): Promise<A2ATaskRecordDto> {
    this.dependencies.assertInitialized();
    const { directory, targetResolver, scheduler } = this.dependencies;
    if (ancestry.parentTaskId !== undefined) requireNonEmpty(ancestry.parentTaskId, "parentTaskId");
    const parent = ancestry.parentTaskId === undefined
      ? undefined
      : this.dependencies.tasks.findById(new TaskId(ancestry.parentTaskId));
    if (ancestry.parentTaskId !== undefined && !parent) {
      throw runtimeFault("INVALID_REQUEST", "", "Calling task is no longer available");
    }
    const requestAncestry: A2ATaskAncestryDto = {
      ...ancestry,
      sourceAgentId: ancestry.sourceAgentId ?? agentId,
    };
    const source = directory.getAgentNode(agentId);
    if (!source) throw runtimeFault("INVALID_REQUEST", "", "Calling agent is not registered");
    const adapter = directory.requireAdapter(source.adapterId);
    const session = directory.getSession(agentId);
    if (!adapter.capabilities.delegation || !session || (adapter.canDelegate && !adapter.canDelegate(session))) {
      throw runtimeFault("PERMISSION_DENIED", source.provider, "This session adapter does not expose A2A tools");
    }
    this.assertCommunicationPermission(source.agentId, input, source.provider);
    const room = directory.getRoomForAgent(agentId);
    if (!room) throw runtimeFault("INVALID_REQUEST", source.provider, "Calling agent is not registered in a room");
    this.validateNativeTargetRequest(input, source.provider);
    const delivery = this.deliveryPolicy.prepare(source, room, input, requestAncestry);
    const { interaction, targetInput, metadata } = delivery;
    try {
      const target = await targetResolver.resolveNativeCallerTarget(
        source,
        session,
        room,
        targetInput,
        interaction === "A2A" ? [] : [agentId],
        parent ? toA2ATaskDto(parent.task) : undefined,
      );
      const { resolvedTargetAgent, ...submissionTarget } = target;
      const parentController = parent ? this.dependencies.abortControllers.get(parent.task.taskId) : undefined;
      const scheduleAncestry: A2ATaskAncestryDto = {
        sourceAgentId: requestAncestry.sourceAgentId ?? agentId,
        ...(requestAncestry.flowParentTaskId ?? requestAncestry.parentTaskId
          ? { flowParentTaskId: requestAncestry.flowParentTaskId ?? requestAncestry.parentTaskId }
          : {}),
        ...(!input.callbackForTaskId && requestAncestry.parentTaskId
          ? { parentTaskId: requestAncestry.parentTaskId }
          : {}),
        ...(resolvedTargetAgent ? { resolvedTargetAgentId: resolvedTargetAgent } : {}),
      };
      const scheduled = scheduler.schedule({
        roomId: room.roomId,
        ...submissionTarget,
        message: targetInput.message,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        metadata,
      }, scheduleAncestry, parentController ? { signal: parentController.signal } : {});
      if (parentController) {
        const cancelChild = (): void => { void this.dependencies.cancelTask(scheduled.record.task.taskId).catch(() => undefined); };
        parentController.signal.addEventListener("abort", cancelChild, { once: true });
        if (parentController.signal.aborted) cancelChild();
        void scheduled.completion.finally(() => parentController.signal.removeEventListener("abort", cancelChild)).catch(() => undefined);
      }
      const releasePendingRequest = this.dependencies.trackPendingAsyncRequest(source.agentId);
      void scheduled.completion.then(releasePendingRequest, releasePendingRequest);
      await scheduled.persisted;
      this.deliveryPolicy.commitCallbackReservation(delivery);
      void scheduled.completion.catch(() => undefined);
      return scheduled.record;
    } finally {
      this.deliveryPolicy.releaseCallbackReservation(delivery);
    }
  }

  private validateNativeTargetRequest(input: AgentSessionToolRequest, provider: string): void {
    requireNonEmpty(input.message, "message");
    if (input.targetAgent !== undefined) requireNonEmpty(input.targetAgent, "targetAgent");
    if (input.responseForTaskId !== undefined) requireNonEmpty(input.responseForTaskId, "responseForTaskId");
    if (input.callbackForTaskId !== undefined) requireNonEmpty(input.callbackForTaskId, "callbackForTaskId");
    if (input.targetSessionName !== undefined) {
      requireNonEmpty(input.targetSessionName, "targetSessionName");
      if (input.targetSessionName.trim().length > 120) {
        throw runtimeFault("INVALID_REQUEST", provider, "targetSessionName must be 120 characters or fewer");
      }
    }
    const hasTarget = input.targetAgent !== undefined || input.targetSessionName !== undefined;
    if ((hasTarget && input.selector !== undefined) ||
        (!hasTarget && input.selector === undefined && input.callbackForTaskId === undefined)) {
      throw runtimeFault("INVALID_REQUEST", provider, "Specify a session name/agent ID, a selector, or a reply task ID");
    }
  }

  private assertCommunicationPermission(agentId: string, input: AgentSessionToolRequest, provider: string): void {
    const permissions = this.dependencies.getCommunicationPermissions(agentId);
    if (!permissions) return;
    if (input.interaction === "A2B" && !permissions.a2b) {
      throw runtimeFault("PERMISSION_DENIED", provider, "The active role space does not allow A2B requests");
    }
    const isReply = input.callbackForTaskId !== undefined || input.responseForTaskId !== undefined;
    if (input.interaction !== "A2B" && !isReply && !permissions.a2a) {
      throw runtimeFault("PERMISSION_DENIED", provider, "The active role space does not allow A2A requests");
    }
  }
}
