import type { OpenCodeApiVersion } from "./api.js";
import type { AssistantEventInput, AssistantEventPublisher } from "../../../application/ports/events.js";
import { openCodeMessageText } from "./conversation-mapper.js";
import type { OpenCodeMessage } from "./conversation-protocol.js";

type OpenCodeMessageWithId = OpenCodeMessage & {
  info: NonNullable<OpenCodeMessage["info"]> & { id: string };
};

type ActiveWatch = {
  target: string;
  turnId: string;
  baseline: Set<string>;
  emittedByMessage: Map<string, string>;
  publish: AssistantEventPublisher;
  timer: ReturnType<typeof setInterval>;
  polling: boolean;
  pollController?: AbortController;
};

/** Polls OpenCode's session messages and publishes common turn lifecycle events. */
export class OpenCodeTurnWatcher {
  private readonly watches = new Map<string, ActiveWatch>();
  private closed = false;

  constructor(
    private readonly apiVersion: OpenCodeApiVersion,
    private readonly listMessages: (sessionId: string, signal: AbortSignal) => Promise<OpenCodeMessage[]>,
    private readonly getStatuses: (signal: AbortSignal) => Promise<unknown>,
  ) {}

  isWatching(sessionId: string): boolean {
    return this.watches.has(sessionId);
  }

  start(
    target: string,
    sessionId: string,
    turnId: string,
    baseline: Set<string>,
    publish: AssistantEventPublisher,
  ): void {
    const watch = {
      target,
      turnId,
      baseline,
      emittedByMessage: new Map<string, string>(),
      publish,
      timer: setInterval(() => void this.pollSession(sessionId), 700),
      polling: false,
    } satisfies ActiveWatch;
    this.watches.set(sessionId, watch);
    publish({ target, threadId: sessionId, provider: "opencode", type: "turnStarted", turnId });
  }

  stop(sessionId: string): ActiveWatch | undefined {
    const watch = this.watches.get(sessionId);
    if (!watch) return undefined;
    clearInterval(watch.timer);
    watch.pollController?.abort();
    delete watch.pollController;
    this.watches.delete(sessionId);
    return watch;
  }

  resume(sessionId: string, watch: ActiveWatch): void {
    if (this.closed) return;
    watch.timer = setInterval(() => void this.pollSession(sessionId), 700);
    this.watches.set(sessionId, watch);
  }

  close(): void {
    this.closed = true;
    for (const sessionId of this.watches.keys()) this.stop(sessionId);
  }

  private async pollSession(sessionId: string): Promise<void> {
    const watch = this.watches.get(sessionId);
    if (!watch || watch.polling || this.closed) return;
    watch.polling = true;
    const pollController = new AbortController();
    watch.pollController = pollController;
    try {
      const [messages, statuses] = await Promise.all([
        this.listMessages(sessionId, pollController.signal),
        this.apiVersion === "v1"
          ? this.getStatuses(pollController.signal).catch((error) => {
            if (pollController.signal.aborted) throw error;
            return {};
          })
          : Promise.resolve({}),
      ]);
      if (this.watches.get(sessionId) !== watch) return;
      const status = asObject(asObject(statuses)?.[sessionId]);
      const statusType = typeof status?.type === "string" ? status.type : "";
      const newAssistantMessages = messages.filter((message): message is OpenCodeMessageWithId =>
        message.info?.role === "assistant" && typeof message.info.id === "string" && !watch.baseline.has(message.info.id),
      );
      const idleMessage = this.apiVersion === "v2"
        ? [...messages].reverse().find((message) => message.info?.type === "idle" && typeof message.info.id === "string" && !watch.baseline.has(message.info.id))
        : undefined;
      for (const message of newAssistantMessages) {
        const messageId = message.info.id;
        const text = openCodeMessageText(message);
        const previous = watch.emittedByMessage.get(messageId) ?? "";
        if (text.startsWith(previous) && text.length > previous.length) {
          this.publish(watch, sessionId, { type: "assistantDelta", turnId: watch.turnId, messageId, text: text.slice(previous.length) });
          watch.emittedByMessage.set(messageId, text);
        } else if (text && text !== previous) {
          watch.emittedByMessage.set(messageId, text);
          this.publish(watch, sessionId, { type: "assistantDelta", turnId: watch.turnId, messageId, text });
        }
      }
      const hasResponse = newAssistantMessages.length > 0;
      const latestAssistant = newAssistantMessages.at(-1);
      const completedAt = latestAssistant?.info?.time?.completed;
      const done = this.apiVersion === "v2"
        ? Boolean(idleMessage)
        : hasResponse && (statusType === "idle" || (!statusType && typeof completedAt === "number" && completedAt > 0));
      if (!done) return;
      for (const message of newAssistantMessages) {
        const messageId = message.info?.id;
        if (typeof messageId !== "string") continue;
        const text = openCodeMessageText(message);
        this.publish(watch, sessionId, { type: "assistantMessageCompleted", turnId: watch.turnId, messageId, text });
      }
      this.stop(sessionId);
      const outcome = idleMessage?.info?.outcome;
      const turnStatus = outcome === "interrupted" ? "interrupted" : outcome === "failed" ? "failed" : "completed";
      this.publish(watch, sessionId, { type: "turnCompleted", turnId: watch.turnId, status: turnStatus });
    } catch (error) {
      if (!pollController.signal.aborted) {
        this.publish(watch, sessionId, { type: "warning", message: `OpenCode 상태를 가져오지 못했습니다: ${errorMessage(error)}` });
      }
    } finally {
      if (watch.pollController === pollController) delete watch.pollController;
      watch.polling = false;
    }
  }

  private publish(watch: ActiveWatch, sessionId: string, event: AssistantEventInput): void {
    watch.publish({ ...event, target: watch.target, threadId: sessionId, provider: "opencode" });
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
