export const SKILL_PROVIDERS = ["Codex", "Pi", "Shared"] as const;
export type SkillProvider = typeof SKILL_PROVIDERS[number];

/** Provider and name selected by an interface after parsing its skill command syntax. */
export type SkillSelection = { name: string; provider?: SkillProvider };

export type SkillInputPreparation =
  | { status: "ready"; inputText: string; skill: AvailableSkill }
  | { status: "notFound" }
  | { status: "disabled"; skill: AvailableSkill }
  | { status: "ambiguous"; name: string; skills: AvailableSkill[] };

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
