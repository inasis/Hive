import type { AssistantEventPublisher } from "../application/ports/events.js";
import type { TerminalEventSink } from "../application/ports/terminal.js";
import type { CodexCliEvent } from "../application/ports/codex-cli.js";
import { CodexSessionManager } from "../adapters/providers/codex/session-manager.js";
import { handleCodexNotification } from "../adapters/providers/codex/notifications.js";
import { OpenCodeSessionManager } from "../adapters/providers/opencode/session-manager.js";
import { KiroSessionManager } from "../adapters/providers/kiro/session-manager.js";
import { handleKiroNotification } from "../adapters/providers/kiro/session-notifications.js";
import { createKiroServerRequestHandler } from "../adapters/providers/kiro/server-requests.js";
import { PtyTerminalAdapter } from "../adapters/terminal/pty-manager.js";
import { RoutedWorkspaceFileAdapter } from "../adapters/workspace/files.js";
import { ProviderApprovalUseCases } from "../application/use-cases/provider-approvals.js";
import { ProviderCatalogUseCases } from "../application/use-cases/provider-catalog.js";
import { ProviderCommandUseCases } from "../application/use-cases/provider-commands.js";
import { ProviderConversationUseCases } from "../application/use-cases/provider-conversations.js";
import { ProviderForkUseCases } from "../application/use-cases/provider-forks.js";
import { ProviderSessionUseCases } from "../application/use-cases/provider-sessions.js";
import { ProviderSettingsUseCases } from "../application/use-cases/provider-settings.js";
import { ProviderSkillUseCases } from "../application/use-cases/provider-skills.js";
import { ProviderTurnUseCases } from "../application/use-cases/provider-turns.js";
import { TerminalUseCases } from "../application/use-cases/terminal.js";
import { WorkspaceFileUseCases } from "../application/use-cases/workspace-files.js";

/** Build the provider and infrastructure adapters shared by daemon and CLI composition roots. */
export function createAssistantRuntime(
  publishEvent: AssistantEventPublisher,
  publishTerminalEvent: TerminalEventSink,
  publishCodexCliEvent?: (event: CodexCliEvent) => void,
) {
  const codexProvider = new CodexSessionManager((target, session, method, params, requestId) =>
    handleCodexNotification(publishEvent, target, session, method, params, requestId), publishCodexCliEvent);
  const openCodeProvider = new OpenCodeSessionManager((event) => publishEvent({ ...event, provider: "opencode" }));
  const workspaceFiles = new RoutedWorkspaceFileAdapter();
  const terminal = new PtyTerminalAdapter(publishTerminalEvent);
  const kiroServerRequestHandler = createKiroServerRequestHandler(workspaceFiles, publishEvent);
  const kiroProvider = new KiroSessionManager(
    kiroServerRequestHandler,
    (session, target, notification) => handleKiroNotification(session, target, notification, publishEvent),
    publishEvent,
  );
  const providers = { codex: codexProvider, opencode: openCodeProvider, kiro: kiroProvider };
  const useCases = {
    providerCatalog: new ProviderCatalogUseCases(providers),
    providerSessions: new ProviderSessionUseCases(providers),
    providerConversations: new ProviderConversationUseCases(providers),
    providerForks: new ProviderForkUseCases(providers),
    providerSkills: new ProviderSkillUseCases(providers),
    providerCommands: new ProviderCommandUseCases(providers),
    providerTurns: new ProviderTurnUseCases(providers),
    providerSettings: new ProviderSettingsUseCases(providers),
    providerApprovals: new ProviderApprovalUseCases(providers),
    terminal: new TerminalUseCases(terminal),
    workspaceFiles: new WorkspaceFileUseCases(workspaceFiles),
  };

  return {
    codexProvider,
    openCodeProvider,
    kiroProvider,
    providers,
    useCases,
    warmOpenCodeProvider: () => openCodeProvider.warmLocal(),
    stopOpenCodeProvider: () => openCodeProvider.closeAll(),
    terminateKiro: () => kiroProvider.terminateAll(),
  };
}
