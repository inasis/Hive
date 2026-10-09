import type { CodexCliSessionPort, CodexCliSkillPort } from "../../application/ports/codex-cli.js";
import type { ProviderApprovalsPorts } from "../../application/ports/provider-approvals.js";
import type { ProviderCatalogPorts } from "../../application/ports/provider-catalog.js";
import type { ProviderCommandsPorts } from "../../application/ports/provider-commands.js";
import type { ProviderConversationPorts } from "../../application/ports/provider-conversations.js";
import type { ProviderForkPorts } from "../../application/ports/provider-forks.js";
import type { ProviderSessionPorts } from "../../application/ports/provider-sessions.js";
import type { ProviderSettingsPorts } from "../../application/ports/provider-settings.js";
import type { ProviderSkillsPorts } from "../../application/ports/provider-skills.js";
import type { ProviderTurnsPorts } from "../../application/ports/provider-turns.js";

/** Concrete provider adapters grouped by the application port each one implements. */
export type AssistantProviderPorts = {
  catalogs: ProviderCatalogPorts;
  sessions: ProviderSessionPorts;
  conversations: ProviderConversationPorts;
  forks: ProviderForkPorts;
  skills: ProviderSkillsPorts;
  commands: ProviderCommandsPorts;
  turns: ProviderTurnsPorts;
  settings: ProviderSettingsPorts;
  approvals: ProviderApprovalsPorts;
  codexCliSessions: CodexCliSessionPort;
  codexCliSkills: CodexCliSkillPort;
};
