import { DEFAULT_ASSISTANT_PROVIDER, type AssistantProvider } from "../../domain/provider-catalog.js";
import { isProviderDaemonApiMethod, type DaemonApiMethod, type DaemonApiRequestMap, type DaemonApiResponseMap, type ProviderDaemonApiMethod } from "../contracts/daemon-api.js";
import { parseDaemonApiRequest } from "../contracts/daemon-request.js";

type ResolveProviderParams<Params> = Params extends unknown
  ? Params extends { provider?: AssistantProvider }
    ? Params extends { provider: infer Provider extends AssistantProvider }
      ? Omit<Params, "provider"> & { provider: Provider }
      : Omit<Params, "provider"> & { provider: Exclude<Params["provider"], undefined> extends AssistantProvider
          ? Exclude<Params["provider"], undefined>
          : never }
    : Params
  : never;

type ResolvedRequestParams<Method extends DaemonApiMethod> = Method extends ProviderDaemonApiMethod
  ? ResolveProviderParams<DaemonApiRequestMap[Method]>
  : DaemonApiRequestMap[Method];

export type ResolvedDaemonApiRequestMap = {
  [Method in DaemonApiMethod]: ResolvedRequestParams<Method>;
};

export type DaemonRequestHandlerMap = {
  [Method in DaemonApiMethod]: (params: ResolvedDaemonApiRequestMap[Method]) => Promise<DaemonApiResponseMap[Method]>;
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
    const request = resolveProvider(parseDaemonApiRequest(method, params));
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

type ResolvedDaemonApiRequest = {
  [Method in DaemonApiMethod]: { method: Method; params: ResolvedDaemonApiRequestMap[Method] };
}[DaemonApiMethod];

/** Apply the backward-compatible default provider once, before any method handler runs. */
function resolveProvider(request: ReturnType<typeof parseDaemonApiRequest>): ResolvedDaemonApiRequest {
  if (!isProviderDaemonApiMethod(request.method)) return request as ResolvedDaemonApiRequest;
  const providerRequest = request as Extract<typeof request, { method: ProviderDaemonApiMethod }>;
  return {
    ...providerRequest,
    params: {
      ...providerRequest.params,
      provider: providerRequest.params.provider ?? DEFAULT_ASSISTANT_PROVIDER,
    },
  } as ResolvedDaemonApiRequest;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled daemon request: ${JSON.stringify(value)}`);
}
