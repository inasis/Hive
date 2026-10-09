import { Icon } from "../../shared/Icon";
import type { usePersonaProfiles } from "./usePersonaProfiles";

const PROFILE_FIELDS: ReadonlyArray<{
  key: "role" | "personality" | "persona" | "instructions";
  label: string;
  hint: string;
  placeholder: string;
  rows: number;
}> = [
  { key: "role", label: "역할", hint: "에이전트의 담당 역할이나 전문 분야입니다.", placeholder: "예: 사용자의 코드를 함께 살피는 개발 파트너", rows: 3 },
  { key: "personality", label: "퍼스널리티", hint: "말투와 답변의 분위기를 정합니다.", placeholder: "예: 정확하고 간결하며 친근하게 설명합니다.", rows: 3 },
  { key: "persona", label: "페르소나", hint: "대화에서 취할 관점이나 태도입니다.", placeholder: "예: 근거를 확인하고 실용적인 선택지를 제안합니다.", rows: 3 },
  { key: "instructions", label: "추가 지침", hint: "필요한 경우 짧은 보완 지침을 적습니다.", placeholder: "예: 설명 뒤에 바로 실행할 다음 단계를 덧붙입니다.", rows: 3 },
];

export function PersonaSettingsPage({ configuration, addSpace, addProfile, updateProfile, onOpenRoleSpace }: ReturnType<typeof usePersonaProfiles> & {
  onOpenRoleSpace: () => void;
}) {
  const activeSpace = configuration.spaces.find((space) => space.id === configuration.activeSpaceId) ?? configuration.spaces[0] ?? null;
  const activeProfile = activeSpace?.profiles.find((profile) => profile.id === configuration.activeProfileId)
    ?? activeSpace?.profiles[0]
    ?? null;

  return <section className="feature-page settings-page persona-page">
    <div className="feature-heading"><span className="eyebrow">{activeSpace ? `ROLE SPACE / ${activeSpace.name}` : "ROLE SPACE"}</span><h1>{activeProfile?.name || "페르소나"}</h1><p>역할 공간에 속한 페르소나의 이름과 응답 지침을 편집합니다.</p></div>
    {activeProfile && activeSpace ? <>
      <div className="persona-space-context">
        <button className="toolbar-button subtle" type="button" onClick={onOpenRoleSpace}><Icon name="sparkles" />{activeSpace.name} 역할 공간 설정</button>
      </div>
      <section className="settings-panel persona-settings-panel" aria-label={`${activeProfile.name || "페르소나"} 설정`}>
        <div className="persona-profile-editor">
          <label className="persona-guidance-field" htmlFor="persona-profile-name">
            <span>페르소나 이름</span>
            <input id="persona-profile-name" value={activeProfile.name} onChange={(event) => updateProfile(activeProfile.id, { name: event.target.value })} placeholder="예: 코드 리뷰 파트너" />
          </label>
          {PROFILE_FIELDS.map((field) => {
            const id = `persona-definition-${field.key}`;
            return <label className="persona-guidance-field" htmlFor={id} key={field.key}>
              <span>{field.label}</span>
              <small>{field.hint}</small>
              <textarea id={id} value={activeProfile[field.key]} onChange={(event) => updateProfile(activeProfile.id, { [field.key]: event.target.value })} placeholder={field.placeholder} rows={field.rows} />
            </label>;
          })}
          <p className="persona-settings-note">선택한 페르소나는 각 세션 요청에 별도 컨텍스트로 전달됩니다. 세션 상태는 대화 세션 안에서 관리됩니다. API 키, 비밀번호, 토큰, 개인키 같은 비밀값은 입력하지 마세요.</p>
        </div>
      </section>
    </> : <div className="feature-empty persona-empty">
      <Icon name="sparkles" />
      <h2>{activeSpace ? "이 역할 공간에 페르소나가 없습니다" : "페르소나를 만들 역할 공간이 없습니다"}</h2>
      <p>{activeSpace ? "역할 공간에서 페르소나를 추가하거나, 아래 버튼으로 바로 시작하세요." : "역할 공간을 먼저 만든 뒤 페르소나를 추가할 수 있습니다."}</p>
      {activeSpace
        ? <button className="toolbar-button subtle" type="button" onClick={() => addProfile(activeSpace.id)}><Icon name="plus" />페르소나 추가</button>
        : <button className="toolbar-button subtle" type="button" onClick={() => addSpace()}><Icon name="plus" />역할 공간 추가</button>}
    </div>}
  </section>;
}
