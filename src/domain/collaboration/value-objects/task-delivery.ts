export type InteractionModeValue = "A2A" | "A2B";
export type TaskDeliveryValue =
  | "a2a-async-request"
  | "a2a-result-delivery"
  | "a2a-result-callback"
  | "a2b-bonded-request";

const A2A_FLOW_DELIVERIES: ReadonlySet<TaskDeliveryValue> = new Set([
  "a2a-async-request",
  "a2a-result-delivery",
  "a2a-result-callback",
]);

export function isTaskDeliveryValue(value: unknown): value is TaskDeliveryValue {
  return value === "a2a-async-request" || value === "a2a-result-delivery" ||
    value === "a2a-result-callback" || value === "a2b-bonded-request";
}

export class InteractionMode {
  private constructor(readonly value: InteractionModeValue) {}

  equals(other: InteractionMode): boolean {
    return this.value === other.value;
  }

  static from(value: unknown): InteractionMode {
    const mode = this.tryFrom(value);
    if (!mode) throw new Error("Interaction mode must be A2A or A2B");
    return mode;
  }

  static tryFrom(value: unknown): InteractionMode | undefined {
    if (value !== "A2A" && value !== "A2B") return undefined;
    return new InteractionMode(value);
  }
}

/** Delivery metadata is a value, kept separate from the original interaction mode. */
export class TaskDelivery {
  private constructor(readonly value: TaskDeliveryValue) {}

  equals(other: TaskDelivery): boolean {
    return this.value === other.value;
  }

  static from(value: unknown): TaskDelivery | undefined {
    if (value === undefined) return undefined;
    if (!isTaskDeliveryValue(value)) throw new Error("Task delivery is not supported");
    return new TaskDelivery(value);
  }

  static isA2AFlowValue(value: unknown): value is TaskDeliveryValue {
    return isTaskDeliveryValue(value) && A2A_FLOW_DELIVERIES.has(value);
  }

  get interactionMode(): InteractionMode | undefined {
    if (this.value === "a2b-bonded-request") return InteractionMode.from("A2B");
    if (A2A_FLOW_DELIVERIES.has(this.value)) return InteractionMode.from("A2A");
    return undefined;
  }

  get isA2AFlow(): boolean {
    return A2A_FLOW_DELIVERIES.has(this.value);
  }
}
