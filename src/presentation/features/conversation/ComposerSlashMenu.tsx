import type { RemoteCommand, RemoteSkill } from "../../shared/bridge";
import type { SlashMenuItem } from "../../shared/slash-menu";

export function ComposerSlashMenu({
  items,
  activeIndex,
  loading,
  skillWarnings,
  skills,
  slashCommands,
  onChooseItem,
}: {
  items: SlashMenuItem[];
  activeIndex: number;
  loading: boolean;
  skillWarnings: string[];
  skills: RemoteSkill[];
  slashCommands: RemoteCommand[];
  onChooseItem: (item: SlashMenuItem) => void;
}) {
  return <div className="slash-skill-menu" role="listbox" aria-label="현재 세션에서 사용할 수 있는 명령과 스킬" aria-activedescendant={items[activeIndex] ? `slash-skill-${activeIndex}` : undefined}>
    <div className="slash-skill-heading"><b>현재 세션 명령 및 스킬</b><small>{loading ? "목록 새로고침 중…" : `${items.length}개`}</small></div>
    {items.map((item, index) => {
      const label = item.kind === "command" ? `/${item.command.name}` : item.skill.name;
      const description = item.kind === "command" ? item.command.description : item.skill.description || item.skill.id;
      const itemProvider = item.kind === "command" ? `${item.command.provider} · 명령` : item.skill.provider;
      const key = item.kind === "command" ? `${item.command.provider}:command:${item.command.name}` : `${item.skill.provider}:skill:${item.skill.id}`;
      return <button key={key} id={`slash-skill-${index}`} type="button" role="option" aria-selected={index === activeIndex} className={`slash-skill-option ${index === activeIndex ? "active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onChooseItem(item)}>
        <span className="slash-skill-glyph">{item.kind === "command" ? "›" : "/"}</span><span className="slash-skill-copy"><b>{label}</b><small>{description || (item.kind === "command" && item.command.takesArguments ? "명령 인자를 입력할 수 있습니다." : "")}</small></span><span className="slash-skill-provider">{itemProvider}</span>
      </button>;
    })}
    {!loading && !items.length && <div className="slash-skill-empty">{skillWarnings.length ? skillWarnings[0] : skills.length || slashCommands.length ? "일치하는 명령 또는 스킬이 없습니다." : "현재 세션에서 사용할 수 있는 명령과 스킬이 없습니다."}</div>}
  </div>;
}
