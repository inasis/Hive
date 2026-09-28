import type { CodexCliEvent, CodexCliOpenedSession, CodexCliSessionPort } from "../../../application/ports/codex-cli.js";
import type { AvailableSkill, SkillCatalog } from "../../../application/ports/skills.js";
import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import type { ProviderForkPort, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../../../application/ports/provider-forks.js";
import type { ProviderSkillsPort, ProviderSkillCatalog } from "../../../application/ports/provider-skills.js";
import type { ProviderCommandsPort, ProviderCommandCatalog, ProviderCommandResult } from "../../../application/ports/provider-commands.js";
import type { ProviderTurnsPort, ProviderPromptInput, ProviderPromptResult, ProviderSteerInput, ProviderSteerResult, ProviderInterruptResult } from "../../../application/ports/provider-turns.js";
import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import type { ProviderApprovalsPort, ApprovalDecision, ProviderApprovalResult } from "../../../application/ports/provider-approvals.js";
import type { AssistantThread } from "../../../domain/assistant.js";
import { CodexSessionCatalogAdapter } from "./session-catalog.js";
import { CodexSessionCommandAdapter } from "./session-commands.js";
import { CodexSessionContext, type CodexNotificationHandler } from "./session-context.js";
import { CodexSessionForkAdapter } from "./session-forks.js";
import { CodexSessionTurnAdapter } from "./session-turns.js";

/** Provider composition facade. Session, fork, command, and turn behavior lives in port adapters. */
export class CodexSessionManager implements ProviderCatalogPort, ProviderSessionPort, ProviderConversationPort, CodexCliSessionPort, ProviderForkPort, ProviderSkillsPort, ProviderCommandsPort, ProviderTurnsPort, ProviderSettingsPort, ProviderApprovalsPort {
  private readonly context: CodexSessionContext;
  private readonly catalog: CodexSessionCatalogAdapter;
  private readonly commands: CodexSessionCommandAdapter;
  private readonly forks: CodexSessionForkAdapter;
  private readonly turns: CodexSessionTurnAdapter;

  constructor(
    onNotification: CodexNotificationHandler,
    publishCliEvent?: (event: CodexCliEvent) => void,
  ) {
    this.context = new CodexSessionContext(onNotification, publishCliEvent);
    this.catalog = new CodexSessionCatalogAdapter(this.context);
    this.commands = new CodexSessionCommandAdapter(this.context);
    this.forks = new CodexSessionForkAdapter(this.context);
    this.turns = new CodexSessionTurnAdapter(this.context);
  }

  connect(target: string): Promise<ProviderConnectionCatalog> { return this.catalog.connect(target); }
  refresh(target: string): Promise<AssistantThread[]> { return this.catalog.refresh(target); }
  disconnect(target: string): Promise<void> { return this.catalog.disconnect(target); }
  renameThread(target: string, threadId: string, name: string): Promise<void> { return this.catalog.renameThread(target, threadId, name); }
  deleteThread(target: string, threadId: string): Promise<void> { return this.catalog.deleteThread(target, threadId); }
  createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> { return this.catalog.createThread(target, input); }
  openThread(target: string, threadId: string): Promise<ProviderOpenThreadResult> { return this.catalog.openThread(target, threadId); }
  openSession(target: string, threadId: string): Promise<CodexCliOpenedSession> { return this.catalog.openSession(target, threadId); }
  listCliSkills(target: string, threadId: string): Promise<SkillCatalog> { return this.commands.listCliSkills(target, threadId); }
  buildSkillInput(target: string, threadId: string, skill: AvailableSkill, request: string): Promise<string> { return this.commands.buildSkillInput(target, threadId, skill, request); }
  forkSideThread(target: string, threadId: string): Promise<ProviderSideConversationResult> { return this.forks.forkSideThread(target, threadId); }
  forkThread(target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> { return this.forks.forkThread(target, threadId, input); }
  listSkills(target: string, threadId: string, cwd?: string): Promise<ProviderSkillCatalog> { return this.commands.listSkills(target, threadId, cwd); }
  listCommands(target: string, threadId: string): Promise<ProviderCommandCatalog> { return this.commands.listCommands(target, threadId); }
  runCommand(target: string, threadId: string, command: string, argumentsText: string): Promise<ProviderCommandResult> { return this.commands.runCommand(target, threadId, command, argumentsText); }
  sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> { return this.turns.sendPrompt(target, threadId, input); }
  steerTurn(target: string, threadId: string, turnId: string, input: ProviderSteerInput): Promise<ProviderSteerResult> { return this.turns.steerTurn(target, threadId, turnId, input); }
  interruptTurn(target: string, threadId: string, turnId: string): Promise<ProviderInterruptResult> { return this.turns.interruptTurn(target, threadId, turnId); }
  updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> { return this.turns.updateThreadSettings(target, threadId, input); }
  answerApproval(target: string, requestId: number | string, decision: ApprovalDecision): Promise<ProviderApprovalResult> { return this.turns.answerApproval(target, requestId, decision); }
}
