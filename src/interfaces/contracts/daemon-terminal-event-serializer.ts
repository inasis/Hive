import type { TerminalEvent } from "../../application/ports/terminal.js";
import type { SerializedBridgeEvent } from "./daemon-events.js";

/** Serialize the typed terminal port event to the established bridge wire contract. */
export function serializeTerminalEvent(event: TerminalEvent): SerializedBridgeEvent {
  switch (event.type) {
    case "data":
      return { target: event.target, threadId: event.sessionId, method: "terminal/data", params: { data: event.data } };
    case "ready":
      return { target: event.target, threadId: event.sessionId, method: "terminal/ready", params: { cwd: event.cwd } };
    case "error":
      return { target: event.target, threadId: event.sessionId, method: "terminal/error", params: { message: event.message } };
    case "exit":
      return {
        target: event.target,
        threadId: event.sessionId,
        method: "terminal/exit",
        params: { exitCode: event.exitCode, signal: event.signal },
      };
  }
}
