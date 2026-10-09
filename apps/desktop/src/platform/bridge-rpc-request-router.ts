import { isProviderDaemonApiMethod } from "../../../../src/application/dto/daemon/daemon-api.js";
import type { AssistantProvider } from "../../../../src/domain/provider-catalog.js";

const nativeDesktopDaemonMethods = [
  "windowAction",
  "getHostPlatform",
  "getWindowFocus",
  "getGtkSettings",
  "getWindowFrame",
  "setWindowFrame",
  "daemonConnect",
  "daemonRequest",
  "daemonDisconnect",
  "chooseWorkspaceFolder",
];

type BridgeRpcRequestRouterOptions = {
  isMobileApp: boolean;
  isDaemonClient: () => boolean;
  getActiveAssistantProvider: () => AssistantProvider;
  requestDaemon: (method: string, params: unknown) => unknown;
};

/** Routes bridge RPC requests to the native bridge or the connected daemon. */
export function createBridgeRpcRequestRouter<RequestCollection extends object>(
  requests: RequestCollection,
  options: BridgeRpcRequestRouterOptions,
): RequestCollection {
  return new Proxy(requests, {
    get(target, method, receiver) {
      if (typeof method !== "string") return Reflect.get(target, method, receiver);
      const request = Reflect.get(target, method) as ((params: unknown) => unknown) | undefined;
      const includeProvider = isProviderDaemonApiMethod(method);
      const injectProvider = (params: unknown) => {
        if (!includeProvider || typeof params !== "object" || params === null || Array.isArray(params)) return params;
        const object = params as Record<string, unknown>;
        return { ...object, provider: object.provider ?? options.getActiveAssistantProvider() };
      };
      const nativeDesktopDaemon = !options.isMobileApp && options.isDaemonClient();
      if (nativeDesktopDaemon && nativeDesktopDaemonMethods.includes(method)) {
        return Reflect.get(target, method);
      }
      if (!options.isMobileApp && !nativeDesktopDaemon) {
        return includeProvider && request ? (params: unknown) => request(injectProvider(params)) : request;
      }
      return (params: unknown) => options.requestDaemon(method, injectProvider(params));
    },
  }) as RequestCollection;
}
