import type { AssistantEvent, AssistantEventPublisher } from "../../application/ports/events.js";
import type { TerminalEventSink } from "../../application/ports/terminal.js";
import type { CodexCliEvent } from "../../application/ports/codex-cli.js";
import { ProviderApprovalUseCases } from "../../application/use-cases/provider-approvals.js";
import { ProviderCatalogUseCases } from "../../application/use-cases/provider-catalog.js";
import { ProviderDisconnectUseCases } from "../../application/use-cases/provider-disconnect.js";
import { ProviderCommandUseCases } from "../../application/use-cases/provider-commands.js";
import { ProviderConversationUseCases } from "../../application/use-cases/provider-conversations.js";
import { ProviderForkUseCases } from "../../application/use-cases/provider-forks.js";
import { ProviderSessionLifecycleCoordinator } from "../../application/use-cases/provider-session-lifecycle-coordinator.js";
import { ProviderSessionUseCases } from "../../application/use-cases/provider-sessions.js";
import { ProviderSettingsUseCases } from "../../application/use-cases/provider-settings.js";
import { ProviderSkillUseCases } from "../../application/use-cases/provider-skills.js";
import { ProviderTurnUseCases } from "../../application/use-cases/provider-turns.js";
import { TerminalUseCases } from "../../application/use-cases/terminal.js";
import { WorkspaceFileUseCases } from "../../application/use-cases/workspace-files.js";
import { composeAssistantA2A } from "./assistant-a2a-composition.js";
import type { AssistantProviderPorts } from "./assistant-provider-ports.js";
import type { AssistantRuntimeOptions } from "./assistant-runtime-options.js";
import { createCodexProviderComposition } from "./codex-provider-composition.js";
import { createKiroProviderComposition } from "./kiro-provider-composition.js";
import { createOpenCodeProviderComposition } from "./opencode-provider-composition.js";
import { createPiProviderComposition } from "./pi-provider-composition.js";
import { PtyTerminalAdapter } from "../terminal/pty-manager.js";
import { RoutedWorkspaceFileAdapter } from "../workspace/files.js";

export type { AssistantRuntimeOptions } from "./assistant-runtime-options.js";

/** Build concrete provider ports and infrastructure adapters for daemon and CLI composition roots. */
export function createAssistantRuntime(
  publishEvent: AssistantEventPublisher,
  publishTerminalEvent: TerminalEventSink,
  publishCodexCliEvent?: (event: CodexCliEvent) => void,
  options: AssistantRuntimeOptions = {},
) {
  const internalEventListeners = new Set<(event: AssistantEvent) => void>();
  const emitAssistantEvent: AssistantEventPublisher = (event) => {
    publishEvent(event);
    for (const listener of internalEventListeners) listener(event);
  };

  const codex = createCodexProviderComposition(emitAssistantEvent, publishCodexCliEvent);
  const openCode = createOpenCodeProviderComposition(emitAssistantEvent);
  const pi = createPiProviderComposition(emitAssistantEvent);

  const workspaceFiles = new RoutedWorkspaceFileAdapter();
  const terminalAdapter = new PtyTerminalAdapter(publishTerminalEvent);
  const terminal = new TerminalUseCases(terminalAdapter);
  const kiro = createKiroProviderComposition(workspaceFiles, emitAssistantEvent);

  const providerPorts: AssistantProviderPorts = {
    catalogs: {
      codex: codex.ports.catalogs,
      opencode: openCode.ports.catalogs,
      pi: pi.ports.catalogs,
      kiro: kiro.ports.catalogs,
    },
    sessions: {
      codex: codex.ports.sessions,
      opencode: openCode.ports.sessions,
      pi: pi.ports.sessions,
      kiro: kiro.ports.sessions,
    },
    conversations: {
      codex: codex.ports.conversations,
      opencode: openCode.ports.conversations,
      pi: pi.ports.conversations,
      kiro: kiro.ports.conversations,
    },
    forks: {
      codex: codex.ports.forks,
      opencode: openCode.ports.forks,
      pi: pi.ports.forks,
      kiro: kiro.ports.forks,
    },
    skills: {
      codex: codex.ports.skills,
      opencode: openCode.ports.skills,
      pi: pi.ports.skills,
      kiro: kiro.ports.skills,
    },
    commands: {
      codex: codex.ports.commands,
      opencode: openCode.ports.commands,
      pi: pi.ports.commands,
      kiro: kiro.ports.commands,
    },
    turns: {
      codex: codex.ports.turns,
      opencode: openCode.ports.turns,
      pi: pi.ports.turns,
      kiro: kiro.ports.turns,
    },
    settings: {
      codex: codex.ports.settings,
      opencode: openCode.ports.settings,
      pi: pi.ports.settings,
      kiro: kiro.ports.settings,
    },
    approvals: {
      codex: codex.ports.approvals,
      opencode: openCode.ports.approvals,
      pi: pi.ports.approvals,
      kiro: kiro.ports.approvals,
    },
    codexCliSessions: codex.ports.cliSessions,
    codexCliSkills: codex.ports.cliSkills,
  };

  const subscribeAssistantEvents = (handler: (event: AssistantEvent) => void): (() => void) => {
    internalEventListeners.add(handler);
    return () => internalEventListeners.delete(handler);
  };
  const { sessionIdentities, a2aRuntime, a2aReady } = composeAssistantA2A(
    providerPorts,
    emitAssistantEvent,
    subscribeAssistantEvents,
    options,
  );
  const sessionLifecycle = new ProviderSessionLifecycleCoordinator({
    identities: sessionIdentities,
    a2aRuntime,
    a2aReady,
  });
  subscribeAssistantEvents((event) => sessionLifecycle.handleProviderEvent(event));

  const useCases = {
    providerCatalog: new ProviderCatalogUseCases(providerPorts.catalogs, sessionIdentities),
    providerSessions: new ProviderSessionUseCases(
      providerPorts.sessions,
      (provider, target, threadId) => sessionLifecycle.onSessionDeleted(provider, target, threadId),
      (provider, target, threadId, name) => sessionLifecycle.onSessionRenamed(provider, target, threadId, name),
    ),
    providerConversations: new ProviderConversationUseCases(
      providerPorts.conversations,
      sessionIdentities,
      () => sessionLifecycle.onSessionCreated(),
    ),
    providerForks: new ProviderForkUseCases(providerPorts.forks, sessionIdentities),
    providerSkills: new ProviderSkillUseCases(providerPorts.skills),
    providerCommands: new ProviderCommandUseCases(providerPorts.commands, sessionIdentities),
    providerTurns: new ProviderTurnUseCases(providerPorts.turns, emitAssistantEvent, a2aRuntime),
    providerSettings: new ProviderSettingsUseCases(providerPorts.settings),
    providerApprovals: new ProviderApprovalUseCases(providerPorts.approvals),
    providerDisconnect: new ProviderDisconnectUseCases(providerPorts.catalogs, terminalAdapter),
    terminal,
    workspaceFiles: new WorkspaceFileUseCases(workspaceFiles),
    a2a: a2aRuntime,
  };

  return {
    providerPorts,
    providerContexts: { openCode: openCode.context, pi: pi.context, kiro: kiro.context },
    useCases,
    a2aRuntime,
    a2aReady,
  };
}
