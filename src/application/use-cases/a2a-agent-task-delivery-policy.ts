import type { AgentNode, AgentRoom } from "../../application/dto/a2a-collaboration.js";
import type { AgentTaskRecord } from "../../domain/collaboration/aggregates/task.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import { TaskId } from "../../domain/collaboration/value-objects/identifiers.js";
import { InteractionMode, type InteractionModeValue } from "../../domain/collaboration/value-objects/task-delivery.js";
import { InteractionPolicy, type InteractionRuleViolation } from "../../domain/collaboration/policies/interaction-policy.js";
import type {
  A2AAgentSessionToolRequestDto as AgentSessionToolRequest,
  A2ATaskAncestryDto,
} from "../dto/a2a-collaboration.js";
import { requireNonEmpty } from "../validation/a2a-runtime-validation.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

export type A2AAgentTaskDeliveryPlan = {
  interaction: InteractionModeValue;
  targetInput: AgentSessionToolRequest;
  metadata: Record<string, unknown>;
  callbackReservation?: string;
};

type A2AAgentTaskDeliveryPolicyDependencies = {
  tasks: TaskRepository;
  findRoomAgentById(room: AgentRoom, identifier: string): AgentNode | undefined;
  isA2AFlowTask(task: TaskAggregate | undefined): task is TaskAggregate;
  flowIdForTask(task: TaskAggregate): string;
};

/** Enforces bonded delivery, result callback, and async response authorization rules. */
export class A2AAgentTaskDeliveryPolicy {
  constructor(private readonly dependencies: A2AAgentTaskDeliveryPolicyDependencies) {}

  prepare(
    source: AgentNode,
    room: AgentRoom,
    input: AgentSessionToolRequest,
    ancestry: A2ATaskAncestryDto,
  ): A2AAgentTaskDeliveryPlan {
    if (ancestry.parentTaskId !== undefined) requireNonEmpty(ancestry.parentTaskId, "parentTaskId");
    const parent = ancestry.parentTaskId === undefined
      ? undefined
      : this.dependencies.tasks.findById(new TaskId(ancestry.parentTaskId));
    if (ancestry.parentTaskId !== undefined && !parent) {
      throw runtimeFault("INVALID_REQUEST", source.provider, "Calling task is no longer available");
    }
    const interactionMode = input.interaction === undefined
      ? InteractionMode.from("A2A")
      : InteractionMode.tryFrom(input.interaction);
    if (!interactionMode) throw interactionFault(source.provider, "INVALID_INTERACTION");
    const interaction = interactionMode.value;
    const callbackForTaskId = input.callbackForTaskId;
    const responseForTaskId = input.responseForTaskId;
    const bondedParent = parent?.delivery?.value === "a2b-bonded-request";
    const bondedParentViolation = InteractionPolicy.bondedParentViolation({
      bondedParent,
      interaction: interactionMode,
      callbackForParent: callbackForTaskId === parent?.task.taskId,
      responseForParent: responseForTaskId !== undefined,
    });
    if (bondedParentViolation) throw interactionFault(source.provider, bondedParentViolation);
    if (interaction === "A2B") {
      const target = input.targetAgent ? this.dependencies.findRoomAgentById(room, input.targetAgent) : undefined;
      const violation = InteractionPolicy.a2bRequestViolation({
        targetIsRegisteredRoomAgent: Boolean(target && room.agentIds.includes(target.agentId)),
        targetSessionNameProvided: input.targetSessionName !== undefined,
        selectorProvided: input.selector !== undefined,
        callbackProvided: callbackForTaskId !== undefined,
        responseProvided: responseForTaskId !== undefined,
      });
      if (violation) throw interactionFault(source.provider, violation);
    }
    const conflictingDelivery = InteractionPolicy.conflictingDeliveryViolation(
      callbackForTaskId !== undefined,
      responseForTaskId !== undefined,
    );
    if (conflictingDelivery) throw interactionFault(source.provider, conflictingDelivery);

    let metadata: Record<string, unknown>;
    let targetInput = input;
    let callbackReservation: string | undefined;
    if (callbackForTaskId !== undefined) {
      requireNonEmpty(callbackForTaskId, "callbackForTaskId");
      const original = this.dependencies.tasks.findById(new TaskId(callbackForTaskId));
      const originalIsA2AFlow = original?.delivery?.isA2AFlow === true;
      const isA2BRequest = original?.delivery?.value === "a2b-bonded-request";
      const callbackInSameA2AFlow = Boolean(original && originalIsA2AFlow && parent && this.dependencies.isA2AFlowTask(parent) &&
        this.dependencies.flowIdForTask(parent) === this.dependencies.flowIdForTask(original));
      const callbackForBoundAgent = isA2BRequest && parent?.task.taskId === original?.task.taskId && original?.task.targetAgent === source.agentId;
      const callbackTarget = input.targetAgent ? this.dependencies.findRoomAgentById(room, input.targetAgent) : undefined;
      const violation = InteractionPolicy.callbackViolation({
        originalExists: Boolean(original),
        sameA2AFlow: callbackInSameA2AFlow,
        callbackFromBondedAgent: callbackForBoundAgent,
        originalCallerIsAgent: Boolean(original && original.task.sourceAgent !== "orchestrator"),
        sameRoom: Boolean(original && original.task.roomId === room.roomId),
        interaction: interactionMode,
        targetProvided: input.targetAgent !== undefined,
        targetIsOriginalCaller: Boolean(original && callbackTarget?.agentId === original.task.sourceAgent),
        targetSessionNameProvided: input.targetSessionName !== undefined,
        selectorProvided: input.selector !== undefined,
        alreadySubmitted: original?.hasCallbackSubmission ?? false,
      });
      if (violation || !original) {
        throw interactionFault(source.provider, violation ?? "CALLBACK_NOT_AUTHORIZED");
      }
      targetInput = {
        ...input,
        targetAgent: original.task.sourceAgent,
        message: ["Original request:", original.task.message, "Result:", input.message].join("\n\n"),
      };
      metadata = { delivery: "a2a-result-callback", callbackForTaskId };
      callbackReservation = callbackForTaskId;
    } else if (responseForTaskId !== undefined) {
      requireNonEmpty(responseForTaskId, "responseForTaskId");
      const original = this.dependencies.tasks.findById(new TaskId(responseForTaskId));
      const originalIsA2AFlow = original?.delivery?.isA2AFlow === true;
      const violation = InteractionPolicy.responseViolation({
        originalExists: Boolean(original),
        parentIsOriginal: parent?.task.taskId === responseForTaskId,
        originalIsA2AFlow,
        sameRoom: Boolean(original && original.task.roomId === room.roomId),
        interaction: interactionMode,
        selectorProvided: input.selector !== undefined,
      });
      if (violation) throw interactionFault(source.provider, violation);
      metadata = { delivery: "a2a-result-delivery", responseForTaskId };
    } else {
      const violation = InteractionPolicy.delegationViolation(bondedParent);
      if (violation) throw interactionFault(source.provider, violation);
      metadata = { delivery: interaction === "A2B" ? "a2b-bonded-request" : "a2a-async-request" };
    }

    if (callbackReservation !== undefined) {
      const original = this.dependencies.tasks.findById(new TaskId(callbackReservation));
      if (!original?.reserveCallbackSubmission()) {
        throw interactionFault(source.provider, "CALLBACK_ALREADY_SUBMITTED");
      }
      this.dependencies.tasks.save(original);
    }
    return {
      interaction,
      targetInput,
      metadata,
      ...(callbackReservation === undefined ? {} : { callbackReservation }),
    };
  }

  releaseCallbackReservation(plan: A2AAgentTaskDeliveryPlan): void {
    if (plan.callbackReservation === undefined) return;
    const original = this.dependencies.tasks.findById(new TaskId(plan.callbackReservation));
    if (!original) return;
    const callbackWasScheduled = this.dependencies.tasks.hasCallbackForTask(new TaskId(plan.callbackReservation));
    if (callbackWasScheduled) original.commitCallbackSubmission();
    else original.releaseCallbackSubmission();
    this.dependencies.tasks.save(original);
  }

  commitCallbackReservation(plan: A2AAgentTaskDeliveryPlan): void {
    if (plan.callbackReservation === undefined) return;
    const original = this.dependencies.tasks.findById(new TaskId(plan.callbackReservation));
    if (!original) throw new Error("Callback task origin no longer exists");
    original.commitCallbackSubmission();
    this.dependencies.tasks.save(original);
  }
}

function interactionFault(provider: string, violation: InteractionRuleViolation): Error {
  if (violation === "BONDED_AGENT_MUST_CALLBACK_OWN_TASK") {
    return runtimeFault("PERMISSION_DENIED", provider, "A bonded agent may only send one result callback for its own A2B task");
  }
  if (violation === "BONDED_AGENT_CANNOT_DELEGATE") {
    return runtimeFault("PERMISSION_DENIED", provider, "A bonded agent cannot delegate another task");
  }
  const messages: Record<Exclude<InteractionRuleViolation, "BONDED_AGENT_MUST_CALLBACK_OWN_TASK" | "BONDED_AGENT_CANNOT_DELEGATE">, string> = {
    INVALID_INTERACTION: "interaction must be A2A or A2B",
    A2B_REQUIRES_EXACT_TARGET: "A2B requires one registered agentId or callerAgentId and does not accept selectors or callbacks",
    CALLBACK_AND_RESPONSE_CONFLICT: "Specify callbackForTaskId or responseForTaskId, not both",
    CALLBACK_NOT_AUTHORIZED: "callbackForTaskId does not identify an active request this agent may answer",
    CALLBACK_TARGET_MISMATCH: "A result callback must target the original calling agent by ID",
    CALLBACK_ALREADY_SUBMITTED: "A result callback was already submitted for this request",
    RESPONSE_NOT_AUTHORIZED: "responseForTaskId must identify this active A2A task",
    A2A_RESPONSE_DELIVERY_REQUIRED: "An A2A request must deliver its response before completing",
  };
  return runtimeFault("INVALID_REQUEST", provider, messages[violation]);
}
