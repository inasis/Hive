import {
  parseDaemonApiRequest,
  type DaemonApiMethod,
  type DaemonApiRequestMap,
  type DaemonApiResponseMap,
} from "../contracts/daemon-api.js";

export type DaemonRequestHandlerMap = {
  [Method in DaemonApiMethod]: (params: DaemonApiRequestMap[Method]) => Promise<DaemonApiResponseMap[Method]>;
};

export interface DaemonRequestDispatcher {
  <Method extends DaemonApiMethod>(method: Method, params: DaemonApiRequestMap[Method]): Promise<DaemonApiResponseMap[Method]>;
  (method: string, params: unknown): Promise<unknown>;
}

/** Validate an incoming daemon call, route it to its application handler, and preserve its typed result. */
export function createDaemonRequestDispatcher(handlers: DaemonRequestHandlerMap): DaemonRequestDispatcher {
  function dispatch<Method extends DaemonApiMethod>(
    method: Method,
    params: DaemonApiRequestMap[Method],
  ): Promise<DaemonApiResponseMap[Method]>;
  function dispatch(method: string, params: unknown): Promise<unknown>;
  async function dispatch(method: string, params: unknown): Promise<unknown> {
    const request = parseDaemonApiRequest(method, params);
    switch (request.method) {
      case "listProviders": return handlers.listProviders(request.params);
      case "connect": return handlers.connect(request.params);
      case "refresh": return handlers.refresh(request.params);
      case "createThread": return handlers.createThread(request.params);
      case "renameThread": return handlers.renameThread(request.params);
      case "deleteThread": return handlers.deleteThread(request.params);
      case "openThread": return handlers.openThread(request.params);
      case "forkSideThread": return handlers.forkSideThread(request.params);
      case "forkThread": return handlers.forkThread(request.params);
      case "listSkills": return handlers.listSkills(request.params);
      case "listCommands": return handlers.listCommands(request.params);
      case "runCommand": return handlers.runCommand(request.params);
      case "sendPrompt": return handlers.sendPrompt(request.params);
      case "steerTurn": return handlers.steerTurn(request.params);
      case "interruptTurn": return handlers.interruptTurn(request.params);
      case "updateThreadSettings": return handlers.updateThreadSettings(request.params);
      case "disconnect": return handlers.disconnect(request.params);
      case "answerApproval": return handlers.answerApproval(request.params);
      case "terminalStart": return handlers.terminalStart(request.params);
      case "terminalInput": return handlers.terminalInput(request.params);
      case "terminalResize": return handlers.terminalResize(request.params);
      case "terminalStop": return handlers.terminalStop(request.params);
      case "listWorkspaceFiles": return handlers.listWorkspaceFiles(request.params);
      case "readWorkspaceFile": return handlers.readWorkspaceFile(request.params);
      default: return assertNever(request);
    }
  }
  return dispatch;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled daemon request: ${JSON.stringify(value)}`);
}
