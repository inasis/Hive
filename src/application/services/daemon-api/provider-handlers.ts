import type { ProviderApprovalUseCases } from "../../use-cases/provider-approvals.js";
import type { ProviderCatalogUseCases } from "../../use-cases/provider-catalog.js";
import type { ProviderCommandUseCases } from "../../use-cases/provider-commands.js";
import type { ProviderConversationUseCases } from "../../use-cases/provider-conversations.js";
import type { ProviderDisconnectUseCases } from "../../use-cases/provider-disconnect.js";
import type { ProviderForkUseCases } from "../../use-cases/provider-forks.js";
import type { ProviderSessionUseCases } from "../../use-cases/provider-sessions.js";
import type { ProviderSettingsUseCases } from "../../use-cases/provider-settings.js";
import type { ProviderSkillUseCases } from "../../use-cases/provider-skills.js";
import type { ProviderTurnUseCases } from "../../use-cases/provider-turns.js";
import type { ProviderDaemonApiMethod } from "../../dto/daemon/daemon-api.js";
import type { DaemonRequestHandlerMap, ResolvedDaemonApiRequestMap } from "./dispatcher.js";
import {
  mapApprovalResponse,
  mapCreateThreadResponse,
  mapForkSideThreadResponse,
  mapForkThreadResponse,
  mapInterruptResponse,
  mapOpenThreadResponse,
  mapPromptResponse,
  mapRunCommandResponse,
  mapSteerResponse,
  mapThreadSettingsResponse,
} from "./response-mappers.js";

type ProviderRequestFor<Method extends ProviderDaemonApiMethod> = ResolvedDaemonApiRequestMap[Method];
type ProviderRequestHandlers = {
  [Key in ProviderDaemonApiMethod]: (params: ProviderRequestFor<Key>) => ReturnType<DaemonRequestHandlerMap[Key]>;
};

export type ProviderDaemonRequestHandlerDependencies = {
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
};

/** Map validated provider daemon requests to their application use cases. */
export function createProviderDaemonRequestHandlers(
  dependencies: ProviderDaemonRequestHandlerDependencies,
): Pick<DaemonRequestHandlerMap, ProviderDaemonApiMethod> {
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
    createThread: async ({ target, cwd, provider, permissionPresets, name }) => mapCreateThreadResponse(
      await dependencies.providerConversations.createThread(
        provider,
        target,
        { cwd, ...(permissionPresets ? { permissionPresets } : {}), ...(name !== undefined ? { name } : {}) },
      ),
    ),
    openThread: async ({ target, threadId, provider, includeTranscript }) => mapOpenThreadResponse(
      await dependencies.providerConversations.openThread(
        provider,
        target,
        threadId,
        { includeTranscript: includeTranscript !== false },
      ),
    ),
    forkSideThread: async ({ target, threadId, provider }) => mapForkSideThreadResponse(
      await dependencies.providerForks.forkSideThread(provider, target, threadId),
    ),
    forkThread: async ({ target, threadId, provider, turnId, messageId, name }) => mapForkThreadResponse(
      await dependencies.providerForks.forkThread(
        provider,
        target,
        threadId,
        { name, ...(turnId !== undefined ? { turnId } : {}), ...(messageId !== undefined ? { messageId } : {}) },
      ),
    ),
    listSkills: async ({ target, threadId, cwd, provider }) => dependencies.providerSkills.listSkills(provider, target, threadId, cwd),
    listCommands: async ({ target, threadId, cwd, provider }) => dependencies.providerCommands.listCommands(provider, target, threadId, cwd),
    runCommand: async ({ target, threadId, command, arguments: argumentsText = "", provider }) => mapRunCommandResponse(
      await dependencies.providerCommands.runCommand(provider, target, threadId, command, argumentsText),
    ),
    sendPrompt: async ({ target, threadId, text, skillId, cwd, images, files, agentContext, provider }) => mapPromptResponse(
      await dependencies.providerTurns.sendPrompt(
        provider,
        target,
        threadId,
        { text, ...(skillId !== undefined ? { skillId } : {}), ...(cwd !== undefined ? { cwd } : {}), ...(images !== undefined ? { images } : {}), ...(files !== undefined ? { files } : {}), ...(agentContext !== undefined ? { agentContext } : {}) },
      ),
    ),
    steerTurn: async ({ target, threadId, turnId, text, skillId, cwd, agentContext, provider }) => mapSteerResponse(
      await dependencies.providerTurns.steerTurn(
        provider,
        target,
        threadId,
        turnId,
        { text, ...(skillId !== undefined ? { skillId } : {}), ...(cwd !== undefined ? { cwd } : {}), ...(agentContext !== undefined ? { agentContext } : {}) },
      ),
    ),
    interruptTurn: async ({ target, threadId, turnId, provider }) => mapInterruptResponse(
      await dependencies.providerTurns.interruptTurn(provider, target, threadId, turnId),
    ),
    updateThreadSettings: async ({ target, threadId, model, effort, permissionProfile, modeId, provider }) => mapThreadSettingsResponse(
      await dependencies.providerSettings.updateThreadSettings(
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
    ),
    disconnect: async ({ target, provider }) => {
      await dependencies.providerDisconnect.disconnect(provider, target);
      return { disconnected: true as const };
    },
    answerApproval: async ({ target, requestId, decision, provider }) => mapApprovalResponse(
      await dependencies.providerApprovals.answerApproval(provider, target, requestId, decision),
    ),
  };

  return providerHandlers;
}
