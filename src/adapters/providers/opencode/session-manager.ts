import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import type { ProviderForkPort, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../../../application/ports/provider-forks.js";
import type { ProviderSkillsPort, ProviderSkillCatalog } from "../../../application/ports/provider-skills.js";
import type { ProviderCommandsPort, ProviderCommandCatalog, ProviderCommandResult } from "../../../application/ports/provider-commands.js";
import type { ProviderTurnsPort, ProviderPromptInput, ProviderPromptResult, ProviderSteerInput, ProviderSteerResult, ProviderInterruptResult } from "../../../application/ports/provider-turns.js";
import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import type { ProviderApprovalsPort, ApprovalDecision, ProviderApprovalResult } from "../../../application/ports/provider-approvals.js";
import { OpenCodeCommandAdapter } from "./session-commands.js";
import { OpenCodeSessionContext } from "./session-context.js";
import { OpenCodeSessionCatalogAdapter } from "./session-catalog.js";
import { OpenCodeSessionForkAdapter } from "./session-forks.js";
import { OpenCodeTurnAdapter } from "./session-turns.js";
import type { OpenCodeEventPublisher } from "./types.js";

/** Provider composition facade; behavior lives in adapters grouped by application port. */
export class OpenCodeSessionManager implements ProviderCatalogPort, ProviderSessionPort, ProviderConversationPort, ProviderForkPort, ProviderSkillsPort, ProviderCommandsPort, ProviderTurnsPort, ProviderSettingsPort, ProviderApprovalsPort {
  private readonly context = new OpenCodeSessionContext();
  private readonly catalog = new OpenCodeSessionCatalogAdapter(this.context);
  private readonly forks = new OpenCodeSessionForkAdapter(this.context);
  private readonly commands: OpenCodeCommandAdapter;
  private readonly turns: OpenCodeTurnAdapter;

  constructor(publish: OpenCodeEventPublisher = () => {}) {
    this.commands = new OpenCodeCommandAdapter(this.context, publish);
    this.turns = new OpenCodeTurnAdapter(this.context, publish);
  }

  connect(target: string): Promise<ProviderConnectionCatalog> { return this.catalog.connect(target); }
  refresh(target: string) { return this.catalog.refresh(target); }
  disconnect(target: string): Promise<void> { return this.catalog.disconnect(target); }
  createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> { return this.catalog.createThread(target, input); }
  openThread(target: string, threadId: string): Promise<ProviderOpenThreadResult> { return this.catalog.openThread(target, threadId); }
  renameThread(target: string, threadId: string, name: string): Promise<void> { return this.catalog.renameThread(target, threadId, name); }
  deleteThread(target: string, threadId: string): Promise<void> { return this.catalog.deleteThread(target, threadId); }
  forkSideThread(target: string, threadId: string): Promise<ProviderSideConversationResult> { return this.forks.forkSideThread(target, threadId); }
  forkThread(target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> { return this.forks.forkThread(target, threadId, input); }
  listSkills(target: string, threadId: string, cwd?: string): Promise<ProviderSkillCatalog> { return this.commands.listSkills(target, threadId, cwd); }
  listCommands(target: string, threadId: string, cwd?: string): Promise<ProviderCommandCatalog> { return this.commands.listCommands(target, threadId, cwd); }
  runCommand(target: string, threadId: string, command: string, argumentsText: string): Promise<ProviderCommandResult> { return this.commands.runCommand(target, threadId, command, argumentsText); }
  sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> { return this.turns.sendPrompt(target, threadId, input); }
  steerTurn(target: string, threadId: string, turnId: string, input: ProviderSteerInput): Promise<ProviderSteerResult> { return this.turns.steerTurn(target, threadId, turnId, input); }
  interruptTurn(target: string, threadId: string, turnId: string): Promise<ProviderInterruptResult> { return this.turns.interruptTurn(target, threadId, turnId); }
  updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> { return this.turns.updateThreadSettings(target, threadId, input); }
  answerApproval(target: string, requestId: number | string, decision: ApprovalDecision): Promise<ProviderApprovalResult> { return this.turns.answerApproval(target, requestId, decision); }

  warmLocal(): Promise<void> { return this.context.warmLocal(); }
  closeAll(): Promise<void> { return this.context.closeAll(); }
}
