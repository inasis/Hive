import { randomUUID } from "node:crypto";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import { mapPiTurnEvent } from "./turn-event-mapper.js";
import type { JsonObject } from "./session-types.js";

type ActiveTurn = {
  handle: PiTurnHandle;
  nextMessageId: number;
  currentMessageId?: string;
  currentMessageText: string;
  assistantMessages: Map<string, string>;
  error?: string;
  interrupted?: boolean;
};

export type PiTurnHandle = {
  readonly turnId: string;
};

/** Owns active Pi turn state and translates Pi lifecycle records into assistant events. */
export class PiTurnEventTracker {
  private readonly turns = new Map<string, ActiveTurn>();
  private readonly turnsByHandle = new WeakMap<PiTurnHandle, ActiveTurn>();

  constructor(private readonly publish: AssistantEventPublisher) {}

  start(target: string, threadId: string): PiTurnHandle {
    const turnId = randomUUID();
    const handle: PiTurnHandle = Object.freeze({ turnId });
    const active: ActiveTurn = {
      handle,
      nextMessageId: 0,
      currentMessageText: "",
      assistantMessages: new Map(),
    };
    this.turns.set(turnKey(target, threadId), active);
    this.turnsByHandle.set(handle, active);
    this.publish({ target, threadId, provider: "pi", type: "turnStarted", turnId });
    return handle;
  }

  ensureStarted(target: string, threadId: string): PiTurnHandle {
    return this.getActiveTurn(target, threadId) ?? this.start(target, threadId);
  }

  getActiveTurn(target: string, threadId: string): PiTurnHandle | undefined {
    return this.turns.get(turnKey(target, threadId))?.handle;
  }

  hasActiveTurn(target: string, threadId: string): boolean {
    return this.turns.has(turnKey(target, threadId));
  }

  markInterrupted(handle: PiTurnHandle): void {
    const active = this.turnsByHandle.get(handle);
    if (active) active.interrupted = true;
  }

  handleRecord(target: string, threadId: () => string, record: JsonObject): void {
    const id = threadId();
    if (!id) return;
    const active = this.turns.get(turnKey(target, id));
    if (!active) return;
    const event = mapPiTurnEvent(record);
    if (!event) return;
    if (event.type === "assistantMessageStarted") {
      active.currentMessageId = `${active.handle.turnId}-message-${active.nextMessageId++}`;
      active.currentMessageText = "";
      active.assistantMessages.set(active.currentMessageId, "");
      return;
    }
    if (event.type === "assistantTextDelta") {
      const messageId = active.currentMessageId ?? `${active.handle.turnId}-message-${active.nextMessageId++}`;
      active.currentMessageId = messageId;
      active.currentMessageText += event.text;
      active.assistantMessages.set(messageId, active.currentMessageText);
      this.publish({ target, threadId: id, provider: "pi", type: "assistantDelta", turnId: active.handle.turnId, messageId, text: event.text });
      return;
    }
    if (event.type === "assistantMessageEnded") {
      const messageId = active.currentMessageId ?? `${active.handle.turnId}-message-${active.nextMessageId++}`;
      const text = event.text || active.currentMessageText;
      active.assistantMessages.set(messageId, text);
      if (text) this.publish({ target, threadId: id, provider: "pi", type: "assistantMessageCompleted", turnId: active.handle.turnId, messageId, text });
      delete active.currentMessageId;
      active.currentMessageText = "";
      return;
    }
    if (event.type === "toolStarted" || event.type === "toolCompleted") {
      this.publish({ target, threadId: id, provider: "pi", type: event.type, turnId: active.handle.turnId, activity: event.activity });
      return;
    }
    if (event.type === "agentError") {
      active.error = event.message;
      return;
    }
    if (event.type === "agentSettled") {
      this.finish(target, id, active.interrupted ? "interrupted" : active.error ? "failed" : "completed", active.error);
    }
  }

  finish(target: string, threadId: string, status: string, error?: string): void {
    const key = turnKey(target, threadId);
    const active = this.turns.get(key);
    if (!active) return;
    this.turns.delete(key);
    this.publish({
      target,
      threadId,
      provider: "pi",
      type: "turnCompleted",
      turnId: active.handle.turnId,
      status,
      ...(error ? { error } : {}),
    });
  }
}

function turnKey(target: string, threadId: string): string {
  return `${target}\u0000${threadId}`;
}
