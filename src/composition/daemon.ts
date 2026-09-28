import { serializeAssistantEvent, serializeTerminalEvent, type BridgeEvent } from "../interfaces/contracts/daemon-events.js";
import type { AssistantEvent } from "../application/ports/events.js";
import { createDaemonRequestDispatcher } from "../interfaces/daemon/dispatcher.js";
import { createDaemonRequestHandlers } from "../interfaces/daemon/handlers.js";
import { createAssistantRuntime } from "./assistant-runtime.js";

const daemonEventListeners = new Set<(event: BridgeEvent) => void>();
const publishBridgeEvent = (event: BridgeEvent): void => {
  for (const listener of daemonEventListeners) listener(event);
};
const publishAssistantEvent = (event: AssistantEvent): void => publishBridgeEvent(serializeAssistantEvent(event));
const runtime = createAssistantRuntime(publishAssistantEvent, (event) => publishBridgeEvent(serializeTerminalEvent(event)));
const handlers = createDaemonRequestHandlers(runtime.useCases);

export function subscribeDaemonEvents(listener: (event: BridgeEvent) => void): () => void {
  daemonEventListeners.add(listener);
  return () => daemonEventListeners.delete(listener);
}

export const dispatchDaemonRequest = createDaemonRequestDispatcher(handlers);

export async function warmOpenCodeProvider(): Promise<void> {
  await runtime.warmOpenCodeProvider();
}

export async function stopOpenCodeProvider(): Promise<void> {
  await runtime.stopOpenCodeProvider();
}

process.once("exit", runtime.terminateKiro);
