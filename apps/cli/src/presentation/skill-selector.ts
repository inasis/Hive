import { SKILL_PROVIDERS, type SkillSelection } from "../../../../src/application/ports/skills.js";

/** Parse CLI-only provider qualification while keeping the selected skill structured for Application. */
export function parseSkillSelector(selector: string): SkillSelection {
  const separator = selector.indexOf(":");
  if (separator <= 0) return { name: selector };

  const providerPrefix = selector.slice(0, separator).toLowerCase();
  const provider = SKILL_PROVIDERS.find((candidate) => candidate.toLowerCase() === providerPrefix);
  return provider
    ? { name: selector.slice(separator + 1), provider }
    : { name: selector };
}
