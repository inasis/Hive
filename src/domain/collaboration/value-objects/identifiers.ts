abstract class StringIdentifier {
  protected constructor(readonly value: string) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("Identifier must be a non-empty string");
    }
  }

  equals(other: StringIdentifier): boolean {
    return this.constructor === other.constructor && this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

export class TaskId extends StringIdentifier {
  constructor(value: string) { super(value); }
}

export class AgentId extends StringIdentifier {
  constructor(value: string) { super(value); }
}

export class RoomId extends StringIdentifier {
  constructor(value: string) { super(value); }
}

export class FlowId extends StringIdentifier {
  constructor(value: string) { super(value); }
}
