import { useMemo, useState } from "react";
import type { RemoteSkill } from "../../shared/bridge";

export function useSkillsBrowser(skills: RemoteSkill[]) {
  const [filter, setFilter] = useState("");
  const [provider, setProvider] = useState("전체 제공자");
  const visibleSkills = useMemo(() => {
    const query = filter.toLowerCase();
    return skills.filter((skill) => (provider === "전체 제공자" || skill.provider === provider) &&
      `${skill.name} ${skill.description} ${skill.provider} ${skill.scope}`.toLowerCase().includes(query),
    );
  }, [filter, provider, skills]);

  return { filter, setFilter, provider, setProvider, visibleSkills };
}
