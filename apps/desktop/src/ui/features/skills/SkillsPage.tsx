import { Icon } from "../../shared/Icon";
import type { RemoteSkill } from "../../../shared/bridge";

type Props = {
  skills: RemoteSkill[];
  visibleSkills: RemoteSkill[];
  warnings: string[];
  connectionState: "disconnected" | "connecting" | "connected";
  activeThreadId: string;
  filter: string;
  onFilterChange: (value: string) => void;
  onOpenConnectionSettings: () => void;
  onOpenSessions: () => void;
  onUseSkill: (skill: RemoteSkill) => void;
};

export function SkillsPage({
  skills,
  visibleSkills,
  warnings,
  connectionState,
  activeThreadId,
  filter,
  onFilterChange,
  onOpenConnectionSettings,
  onOpenSessions,
  onUseSkill,
}: Props) {
  return <section className="feature-page skills-page">
    <div className="feature-heading"><span className="eyebrow">REMOTE CATALOG</span><h1>Skills</h1><p>현재 세션의 provider host와 작업공간에서 사용할 수 있는 스킬입니다.</p></div>
    <div className="feature-toolbar"><label className="skill-search"><Icon name="sparkles" /><input value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="이름, 설명, 제공자로 검색" /></label><span>{visibleSkills.length}개 표시</span></div>
    {connectionState !== "connected" && <div className="feature-empty"><div className="empty-icon"><Icon name="branch" /></div><h2>호스트를 먼저 연결하세요</h2><p>호스트에 연결한 뒤 세션을 열면 사용할 수 있는 스킬 목록을 가져옵니다.</p><button className="dialog-primary" onClick={onOpenConnectionSettings}>연결 설정 열기</button></div>}
    {connectionState === "connected" && !activeThreadId && <div className="feature-empty"><div className="empty-icon"><Icon name="message" /></div><h2>세션을 열어 스킬을 불러오세요</h2><p>스킬 카탈로그는 현재 세션의 원격 작업공간 기준으로 검색됩니다.</p><button className="dialog-primary" onClick={onOpenSessions}>세션 페이지 열기</button></div>}
    {warnings.map((warning) => <div className="skill-warning" key={warning}>{warning}</div>)}
    {connectionState === "connected" && activeThreadId && <div className="skill-grid">{visibleSkills.map((skill) => <article className="skill-card" key={`${skill.provider}-${skill.id}`}><div className="skill-card-icon"><Icon name="sparkles" /></div><div className="skill-card-copy"><div className="skill-card-title"><h2>{skill.name}</h2><span>{skill.provider}</span></div><p>{skill.description || "설명이 제공되지 않았습니다."}</p><small>{skill.scope}</small></div><button className="dialog-secondary" disabled={!skill.enabled} onClick={() => onUseSkill(skill)}><Icon name="arrow-up-right" /> 세션에서 사용</button></article>)}</div>}
    {connectionState === "connected" && activeThreadId && !visibleSkills.length && <div className="feature-empty"><div className="empty-icon"><Icon name="sparkles" /></div><h2>{skills.length ? "검색 결과가 없습니다" : "등록된 스킬이 없습니다"}</h2><p>{skills.length ? "다른 검색어를 입력해 보세요." : "원격 호스트의 스킬 디렉터리에서 사용할 수 있는 스킬을 찾지 못했습니다."}</p></div>}
  </section>;
}
