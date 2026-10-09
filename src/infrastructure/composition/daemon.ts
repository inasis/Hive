import { hostname } from "node:os";
import { serializeAssistantEvent } from "../transport/daemon/daemon-assistant-event-serializer.js";
import { serializeTerminalEvent } from "../transport/daemon/daemon-terminal-event-serializer.js";
import type { SerializedBridgeEvent } from "../../application/dto/daemon/daemon-events.js";
import type { AssistantEvent } from "../../application/ports/events.js";
import { A2AHttpServer } from "../transport/a2a-http-server.js";
import {
  createA2AHttpToolEnvironment,
  isA2AHttpServerEnabled,
  resolveA2AHttpConfiguration,
} from "../transport/a2a-http-configuration.js";
import { createDaemonRequestDispatcher } from "../../application/services/daemon-api/dispatcher.js";
import type { DaemonRequestHandlerMap } from "../../application/services/daemon-api/dispatcher.js";
import { createProviderDaemonRequestHandlers } from "../../application/services/daemon-api/provider-handlers.js";
import { createSharedDaemonRequestHandlers } from "../../application/services/daemon-api/shared-handlers.js";
import { InitializeA2ARoom } from "../../application/use-cases/initialize-a2a-room.js";
import { createAssistantRuntime } from "./assistant-runtime.js";

const daemonEventListeners = new Set<(event: SerializedBridgeEvent) => void>();
const publishBridgeEvent = (event: SerializedBridgeEvent): void => {
  for (const listener of daemonEventListeners) listener(event);
};
const publishAssistantEvent = (event: AssistantEvent): void => publishBridgeEvent(serializeAssistantEvent(event));
const runtime = createAssistantRuntime(publishAssistantEvent, (event) => publishBridgeEvent(serializeTerminalEvent(event)));
const initializeA2ARoom = new InitializeA2ARoom(runtime.a2aRuntime, runtime.a2aReady);
const handlers: DaemonRequestHandlerMap = {
  ...createProviderDaemonRequestHandlers({ ...runtime.useCases, hostName: hostname }),
  ...createSharedDaemonRequestHandlers(runtime.useCases),
};
let a2aHttpServer: A2AHttpServer | undefined;
const a2aHttpToolEnvironment = createA2AHttpToolEnvironment();

export function subscribeDaemonEvents(listener: (event: SerializedBridgeEvent) => void): () => void {
  daemonEventListeners.add(listener);
  return () => daemonEventListeners.delete(listener);
}

export const dispatchDaemonRequest = createDaemonRequestDispatcher(handlers);
export const providerContexts = runtime.providerContexts;

/** Start the authenticated local A2A HTTP/SSE transport as part of daemon startup. */
export async function startConfiguredA2AHttpServer(): Promise<boolean> {
  if (!isA2AHttpServerEnabled()) return false;
  if (a2aHttpServer) return true;
  const configuration = await resolveA2AHttpConfiguration();
  const server = new A2AHttpServer(runtime.a2aRuntime, configuration.serverOptions);
  await server.listen();
  a2aHttpServer = server;
  const { host, port, bearerToken } = configuration.serverOptions;
  a2aHttpToolEnvironment.apply(configuration.mcpUrl, bearerToken);
  process.stdout.write(`Hive A2A ${configuration.protocolLabel} listening on ${host}:${port}\n`);
  if (!configuration.tokenWasConfigured) process.stdout.write(`Hive A2A bearer token file: ${configuration.tokenFilePath}\n`);
  try {
    await initializeA2ARoom.execute(configuration.roomId, configuration.roomName);
    process.stdout.write(`Hive A2A room ready: ${configuration.roomId}\n`);
  } catch (error) {
    a2aHttpServer = undefined;
    await server.close();
    a2aHttpToolEnvironment.restore();
    throw error;
  }
  return true;
}

export async function stopA2AHttpServer(): Promise<void> {
  const server = a2aHttpServer;
  a2aHttpServer = undefined;
  await server?.close();
  a2aHttpToolEnvironment.restore();
}

process.once("exit", () => runtime.providerContexts.kiro.terminateAll());
process.once("exit", () => runtime.providerContexts.pi.terminateAll());
