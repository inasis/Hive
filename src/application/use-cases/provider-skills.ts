import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderSkillCatalog, ProviderSkillsPorts } from "../ports/provider-skills.js";
import { requireProviderCapability } from "./provider-capability.js";
import { validateThreadId } from "./provider-sessions.js";

/** Validate shared skill discovery input and dispatch to the provider adapter. */
export class ProviderSkillUseCases {
  constructor(private readonly providers: ProviderSkillsPorts) {}

  listSkills(provider: AssistantProvider, target: string, threadId: string, cwd?: string): Promise<ProviderSkillCatalog> {
    validateThreadId(threadId);
    requireProviderCapability(provider, "skills", "listing skills");
    return this.providers[provider].listSkills(target, threadId, cwd);
  }
}
