import type { ProviderCatalogUseCases } from "../../application/use-cases/provider-catalog.js";
import type { ProviderDisconnectUseCases } from "../../application/use-cases/provider-disconnect.js";
import type { ProviderConversationUseCases } from "../../application/use-cases/provider-conversations.js";
import type { ProviderForkUseCases } from "../../application/use-cases/provider-forks.js";
import type { ProviderSkillUseCases } from "../../application/use-cases/provider-skills.js";
import type { ProviderCommandUseCases } from "../../application/use-cases/provider-commands.js";
import type { ProviderTurnUseCases } from "../../application/use-cases/provider-turns.js";
import type { ProviderSettingsUseCases } from "../../application/use-cases/provider-settings.js";
import type { ProviderApprovalUseCases } from "../../application/use-cases/provider-approvals.js";
import type { ProviderSessionUseCases } from "../../application/use-cases/provider-sessions.js";
import type { WorkspaceFileUseCases } from "../../application/use-cases/workspace-files.js";
import type { TerminalUseCases } from "../../application/use-cases/terminal.js";
import { ASSISTANT_PROVIDERS, type AssistantProvider } from "../../domain/provider-catalog.js";
import {
  type DaemonApiMethod,
  type DaemonApiRequestMap,
  type DaemonApiResponseMap,
  type ProviderDaemonApiMethod,
  type SharedDaemonApiMethod,
} from "../contracts/daemon-api.js";
import type { DaemonRequestHandlerMap, ResolvedDaemonApiRequestMap } from "./dispatcher.js";

type DaemonRequestHandlers<Method extends DaemonApiMethod> = {
  [Key in Method]: (params: DaemonApiRequestMap[Key]) => Promise<DaemonApiResponseMap[Key]>;
};
type ProviderRequestFor<Method extends ProviderDaemonApiMethod> = ResolvedDaemonApiRequestMap[Method];
type ProviderRequestHandlers = {
  [Key in ProviderDaemonApiMethod]: (params: ProviderRequestFor<Key>) => Promise<DaemonApiResponseMap[Key]>;
};

export type DaemonRequestHandlerDependencies = {
  hostName?: () => string;
  providerCatalog: ProviderCatalogUseCases;
  providerDisconnect: ProviderDisconnectUseCases;
  providerSessions: ProviderSessionUseCases;
  providerConversations: ProviderConversationUseCases;
  providerForks: ProviderForkUseCases;
  providerSkills: ProviderSkillUseCases;
  providerCommands: ProviderCommandUseCases;
  providerTurns: ProviderTurnUseCases;
  providerSettings: ProviderSettingsUseCases;
  providerApprovals: ProviderApprovalUseCases;
  terminal: TerminalUseCases;
  workspaceFiles: WorkspaceFileUseCases;
};

/** Map validated daemon requests to application use cases and infrastructure ports. */
export function createDaemonRequestHandlers(dependencies: DaemonRequestHandlerDependencies): DaemonRequestHandlerMap {
  const providerHandlers: ProviderRequestHandlers = {
    connect: async ({ target, provider }) => {
      const catalog = await dependencies.providerCatalog.connect(provider, target);
      return { target, ...catalog, ...(dependencies.hostName ? { hostname: dependencies.hostName() } : {}) };
    },
    refresh: async ({ target, provider }) => dependencies.providerCatalog.refresh(provider, target),
    renameThread: async ({ target, threadId, name, provider }) => {
      await dependencies.providerSessions.renameThread(provider, target, threadId, name);
      return { renamed: true as const };
    },
    deleteThread: async ({ target, threadId, provider }) => {
      await dependencies.providerSessions.deleteThread(provider, target, threadId);
      return { deleted: true as const };
    },
    createThread: async ({ target, cwd, provider, permissionPresets, name }) => dependencies.providerConversations.createThread(
      provider,
      target,
      { cwd, ...(permissionPresets ? { permissionPresets } : {}), ...(name !== undefined ? { name } : {}) },
    ),
    openThread: async ({ target, threadId, provider, includeTranscript }) => dependencies.providerConversations.openThread(
      provider,
      target,
      threadId,
      { includeTranscript: includeTranscript !== false },
    ),
    forkSideThread: async ({ target, threadId, provider }) => dependencies.providerForks.forkSideThread(provider, target, threadId),
    forkThread: async ({ target, threadId, provider, turnId, messageId, name }) => dependencies.providerForks.forkThread(
      provider,
      target,
      threadId,
      { name, ...(turnId !== undefined ? { turnId } : {}), ...(messageId !== undefined ? { messageId } : {}) },
    ),
    listSkills: async ({ target, threadId, cwd, provider }) => dependencies.providerSkills.listSkills(provider, target, threadId, cwd),
    listCommands: async ({ target, threadId, cwd, provider }) => dependencies.providerCommands.listCommands(provider, target, threadId, cwd),
    runCommand: async ({ target, threadId, command, arguments: argumentsText = "", provider }) => dependencies.providerCommands.runCommand(
      provider,
      target,
      threadId,
      command,
      argumentsText,
    ),
    sendPrompt: async ({ target, threadId, text, skillId, cwd, images, provider }) => dependencies.providerTurns.sendPrompt(
      provider,
      target,
      threadId,
      { text, ...(skillId !== undefined ? { skillId } : {}), ...(cwd !== undefined ? { cwd } : {}), ...(images !== undefined ? { images } : {}) },
    ),
    steerTurn: async ({ target, threadId, turnId, text, skillId, cwd, provider }) => dependencies.providerTurns.steerTurn(
      provider,
      target,
      threadId,
      turnId,
      { text, ...(skillId !== undefined ? { skillId } : {}), ...(cwd !== undefined ? { cwd } : {}) },
    ),
    interruptTurn: async ({ target, threadId, turnId, provider }) => dependencies.providerTurns.interruptTurn(provider, target, threadId, turnId),
    updateThreadSettings: async ({ target, threadId, model, effort, permissionProfile, modeId, provider }) => dependencies.providerSettings.updateThreadSettings(
      provider,
      target,
      threadId,
      {
        ...(model !== undefined ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
        ...(permissionProfile !== undefined ? { permissionProfile } : {}),
        ...(modeId !== undefined ? { modeId } : {}),
      },
    ),
    disconnect: async ({ target, provider }) => {
      await dependencies.providerDisconnect.disconnect(provider, target);
      return { disconnected: true as const };
    },
    answerApproval: async ({ target, requestId, decision, provider }) => dependencies.providerApprovals.answerApproval(provider, target, requestId, decision),
  };

  const sharedHandlers: DaemonRequestHandlers<SharedDaemonApiMethod> = {
    listProviders: async () => ({ providers: [...ASSISTANT_PROVIDERS] }),
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

  return {
    listProviders: sharedHandlers.listProviders,
    ...providerHandlers,
    terminalStart: sharedHandlers.terminalStart,
    terminalInput: sharedHandlers.terminalInput,
    terminalResize: sharedHandlers.terminalResize,
    terminalStop: sharedHandlers.terminalStop,
    listWorkspaceFiles: sharedHandlers.listWorkspaceFiles,
    readWorkspaceFile: sharedHandlers.readWorkspaceFile,
  };
}
