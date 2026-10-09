import type { InteractionMode } from "../value-objects/task-delivery.js";

export type InteractionRuleViolation =
  | "INVALID_INTERACTION"
  | "BONDED_AGENT_MUST_CALLBACK_OWN_TASK"
  | "A2B_REQUIRES_EXACT_TARGET"
  | "CALLBACK_AND_RESPONSE_CONFLICT"
  | "CALLBACK_NOT_AUTHORIZED"
  | "CALLBACK_TARGET_MISMATCH"
  | "CALLBACK_ALREADY_SUBMITTED"
  | "RESPONSE_NOT_AUTHORIZED"
  | "A2A_RESPONSE_DELIVERY_REQUIRED"
  | "BONDED_AGENT_CANNOT_DELEGATE";

export type CallbackAuthorizationFacts = {
  originalExists: boolean;
  sameA2AFlow: boolean;
  callbackFromBondedAgent: boolean;
  originalCallerIsAgent: boolean;
  sameRoom: boolean;
  interaction: InteractionMode;
  targetProvided: boolean;
  targetIsOriginalCaller: boolean;
  targetSessionNameProvided: boolean;
  selectorProvided: boolean;
  alreadySubmitted: boolean;
};

/** Pure A2A/A2B decisions. Application code supplies facts gathered from repositories and runtime state. */
export class InteractionPolicy {
  static bondedParentViolation(input: {
    bondedParent: boolean;
    interaction: InteractionMode;
    callbackForParent: boolean;
    responseForParent: boolean;
  }): InteractionRuleViolation | undefined {
    if (!input.bondedParent ||
        (input.interaction.value === "A2A" && input.callbackForParent && !input.responseForParent)) return undefined;
    return "BONDED_AGENT_MUST_CALLBACK_OWN_TASK";
  }

  static a2bRequestViolation(input: {
    targetIsRegisteredRoomAgent: boolean;
    targetSessionNameProvided: boolean;
    selectorProvided: boolean;
    callbackProvided: boolean;
    responseProvided: boolean;
  }): InteractionRuleViolation | undefined {
    return input.targetIsRegisteredRoomAgent && !input.targetSessionNameProvided && !input.selectorProvided &&
      !input.callbackProvided && !input.responseProvided
      ? undefined
      : "A2B_REQUIRES_EXACT_TARGET";
  }

  static conflictingDeliveryViolation(callbackProvided: boolean, responseProvided: boolean): InteractionRuleViolation | undefined {
    return callbackProvided && responseProvided ? "CALLBACK_AND_RESPONSE_CONFLICT" : undefined;
  }

  static callbackViolation(facts: CallbackAuthorizationFacts): InteractionRuleViolation | undefined {
    if (!facts.originalExists || (!facts.sameA2AFlow && !facts.callbackFromBondedAgent) ||
        !facts.originalCallerIsAgent || !facts.sameRoom) return "CALLBACK_NOT_AUTHORIZED";
    if (facts.interaction.value === "A2B" || (facts.targetProvided && !facts.targetIsOriginalCaller) ||
        facts.targetSessionNameProvided || facts.selectorProvided) return "CALLBACK_TARGET_MISMATCH";
    return facts.alreadySubmitted ? "CALLBACK_ALREADY_SUBMITTED" : undefined;
  }

  static responseViolation(input: {
    originalExists: boolean;
    parentIsOriginal: boolean;
    originalIsA2AFlow: boolean;
    sameRoom: boolean;
    interaction: InteractionMode;
    selectorProvided: boolean;
  }): InteractionRuleViolation | undefined {
    return input.originalExists && input.parentIsOriginal && input.originalIsA2AFlow && input.sameRoom &&
      input.interaction.value !== "A2B" && !input.selectorProvided
      ? undefined
      : "RESPONSE_NOT_AUTHORIZED";
  }

  static taskCompletionViolation(input: {
    requiresResponseDelivery: boolean;
    responseDeliveryAccepted: boolean;
  }): InteractionRuleViolation | undefined {
    return input.requiresResponseDelivery && !input.responseDeliveryAccepted
      ? "A2A_RESPONSE_DELIVERY_REQUIRED"
      : undefined;
  }

  static delegationViolation(bondedParent: boolean): InteractionRuleViolation | undefined {
    return bondedParent ? "BONDED_AGENT_CANNOT_DELEGATE" : undefined;
  }
}
