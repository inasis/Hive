import type { AssistantThread } from "../../../domain/assistant.js";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import type { ProviderForkPort, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../../../application/ports/provider-forks.js";
import type { ProviderSkillsPort, ProviderSkillCatalog } from "../../../application/ports/provider-skills.js";
import type { ProviderCommandsPort, ProviderCommandCatalog, ProviderCommandResult } from "../../../application/ports/provider-commands.js";
import type { ProviderTurnsPort, ProviderPromptInput, ProviderPromptResult, ProviderSteerInput, ProviderSteerResult, ProviderInterruptResult } from "../../../application/ports/provider-turns.js";
import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import type { ProviderApprovalsPort, ApprovalDecision, ProviderApprovalResult } from "../../../application/ports/provider-approvals.js";
import { KiroSessionCatalogAdapter } from "./session-catalog.js";
import { KiroSessionCommandAdapter } from "./session-commands.js";
import { KiroSessionContext, type KiroNotificationHandler, type KiroServerRequestHandler } from "./session-context.js";
import { KiroSessionForkAdapter } from "./session-forks.js";
import { KiroSessionTurnAdapter } from "./session-turns.js";

/** Wires Kiro's port-specific adapters for the provider registry. */
export class KiroSessionManager implements ProviderCatalogPort, ProviderSessionPort, ProviderConversationPort, ProviderForkPort, ProviderSkillsPort, ProviderCommandsPort, ProviderTurnsPort, ProviderSettingsPort, ProviderApprovalsPort {
  private readonly catalogAdapter: KiroSessionCatalogAdapter;
  private readonly commandAdapter: KiroSessionCommandAdapter;
  private readonly forkAdapter: KiroSessionForkAdapter;
  private readonly turnAdapter: KiroSessionTurnAdapter;

  constructor(
    onServerRequest: KiroServerRequestHandler,
    onNotification: KiroNotificationHandler,
    publish: AssistantEventPublisher,
  ) {
    const context = new KiroSessionContext(onServerRequest, onNotification);
    this.catalogAdapter = new KiroSessionCatalogAdapter(context, publish);
    const requireOpenThread = (target: string, threadId: string) => this.catalogAdapter.requireOpenThread(target, threadId);
    this.forkAdapter = new KiroSessionForkAdapter(requireOpenThread, publish);
    this.commandAdapter = new KiroSessionCommandAdapter(
      requireOpenThread,
      (session, target, threadId, turnId, title) => this.forkAdapter.rewindConversation(session, target, threadId, turnId, title),
      publish,
    );
    this.turnAdapter = new KiroSessionTurnAdapter(context, requireOpenThread, publish);
  }

  connect(target: string): Promise<ProviderConnectionCatalog> {
    return this.catalogAdapter.connect(target);
  }

  refresh(target: string): Promise<AssistantThread[]> {
    return this.catalogAdapter.refresh(target);
  }

  createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> {
    return this.catalogAdapter.createThread(target, input);
  }

  openThread(target: string, threadId: string): Promise<ProviderOpenThreadResult> {
    return this.catalogAdapter.openThread(target, threadId);
  }

  forkSideThread(target: string, threadId: string): Promise<ProviderSideConversationResult> {
    return this.forkAdapter.forkSideThread(target, threadId);
  }

  forkThread(target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    return this.forkAdapter.forkThread(target, threadId, input);
  }

  listSkills(target: string, threadId: string, cwd?: string): Promise<ProviderSkillCatalog> {
    return this.commandAdapter.listSkills(target, threadId, cwd);
  }

  listCommands(target: string, threadId: string): Promise<ProviderCommandCatalog> {
    return this.commandAdapter.listCommands(target, threadId);
  }

  runCommand(target: string, threadId: string, command: string, argumentsText: string): Promise<ProviderCommandResult> {
    return this.commandAdapter.runCommand(target, threadId, command, argumentsText);
  }

  sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> {
    return this.turnAdapter.sendPrompt(target, threadId, input);
  }

  steerTurn(target: string, threadId: string, turnId: string, input: ProviderSteerInput): Promise<ProviderSteerResult> {
    return this.turnAdapter.steerTurn(target, threadId, turnId, input);
  }

  interruptTurn(target: string, threadId: string, turnId: string): Promise<ProviderInterruptResult> {
    return this.turnAdapter.interruptTurn(target, threadId, turnId);
  }

  updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    return this.turnAdapter.updateThreadSettings(target, threadId, input);
  }

  answerApproval(target: string, requestId: number | string, decision: ApprovalDecision): Promise<ProviderApprovalResult> {
    return this.turnAdapter.answerApproval(target, requestId, decision);
  }

  renameThread(target: string, threadId: string, name: string): Promise<void> {
    return this.catalogAdapter.renameThread(target, threadId, name);
  }

  deleteThread(target: string, threadId: string): Promise<void> {
    return this.catalogAdapter.deleteThread(target, threadId);
  }

  disconnect(target: string): Promise<void> {
    return this.catalogAdapter.disconnect(target);
  }

  terminateAll(): void {
    this.catalogAdapter.terminateAll();
  }
}
