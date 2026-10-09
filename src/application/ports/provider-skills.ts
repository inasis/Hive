import type { AssistantSkillDto } from "../dto/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ProviderSkillCatalog = { skills: AssistantSkillDto[]; warnings: string[] };

/** Provider skill discovery for an already opened conversation. */
export interface ProviderSkillsPort {
  listSkills(target: string, threadId: string, cwd?: string): Promise<ProviderSkillCatalog>;
}

export type ProviderSkillsPorts = Record<AssistantProvider, ProviderSkillsPort>;
