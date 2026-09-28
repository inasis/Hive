export type SkillProvider = "Codex" | "Pi" | "Shared";

/** Skill metadata consumed by UI and prompt use cases; provider file formats stay in adapters. */
export type AvailableSkill = {
  name: string;
  description: string;
  path: string;
  provider: SkillProvider;
  scope: string;
  enabled: boolean;
  defaultPrompt?: string;
};

export type SkillCatalog = {
  skills: AvailableSkill[];
  warnings: string[];
};
