import type { TerminalUseCases } from "../../use-cases/terminal.js";
import type { ProviderCatalogUseCases } from "../../use-cases/provider-catalog.js";
import type { WorkspaceFileUseCases } from "../../use-cases/workspace-files.js";
import type { SharedDaemonApiMethod } from "../../dto/daemon/daemon-api.js";
import type { DaemonRequestHandlerMap } from "./dispatcher.js";

export type SharedDaemonRequestHandlerDependencies = {
  providerCatalog: ProviderCatalogUseCases;
  terminal: TerminalUseCases;
  workspaceFiles: WorkspaceFileUseCases;
};

/** Map validated catalog, terminal, and workspace daemon requests to application use cases. */
export function createSharedDaemonRequestHandlers(
  dependencies: SharedDaemonRequestHandlerDependencies,
): Pick<DaemonRequestHandlerMap, SharedDaemonApiMethod> {
  return {
    listProviders: async () => ({ providers: dependencies.providerCatalog.listProviders() }),
    terminalStart: async ({ target, cwd, sessionId, cols, rows }) => {
      await dependencies.terminal.start({ target, cwd, sessionId, cols, rows });
      return { sessionId, started: true as const };
    },
    terminalInput: async ({ target, sessionId, data }) => {
      dependencies.terminal.input(target, sessionId, data);
      return { written: true as const };
    },
    terminalResize: async ({ target, sessionId, cols, rows }) => {
      dependencies.terminal.resize(target, sessionId, cols, rows);
      return { resized: true as const };
    },
    terminalStop: async ({ target, sessionId }) => {
      dependencies.terminal.stop(target, sessionId);
      return { stopped: true as const };
    },
    listWorkspaceFiles: async ({ target, cwd, path }) => dependencies.workspaceFiles.list(target, cwd, path),
    readWorkspaceFile: async ({ target, cwd, path }) => dependencies.workspaceFiles.read(target, cwd, path),
  };
}
