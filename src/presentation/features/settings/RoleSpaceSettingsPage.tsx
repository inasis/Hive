import { Icon } from "../../shared/Icon";
import type { usePersonaProfiles } from "./usePersonaProfiles";

export function RoleSpaceSettingsPage({ configuration, addSpace, deleteSpace, updateSpace, deleteProfile, onOpenPersona, onAddPersona }: ReturnType<typeof usePersonaProfiles> & {
  onOpenPersona: (profileId: string) => void;
  onAddPersona: (spaceId: string) => void;
}) {
  const activeSpace = configuration.spaces.find((space) => space.id === configuration.activeSpaceId) ?? configuration.spaces[0] ?? null;
  const selectedProfileId = activeSpace?.profiles.some((profile) => profile.id === configuration.activeProfileId)
    ? configuration.activeProfileId
    : null;

  return <section className="feature-page settings-page role-space-page">
    <div className="feature-heading"><span className="eyebrow">WORKSPACE / ROLE SPACE</span><h1>역할 공간</h1><p>공간 이름과 A2A 및 A2B 권한을 관리하고, 이 공간의 페르소나를 선택합니다.</p></div>
    {activeSpace ? <section className="settings-panel role-space-settings-panel" aria-label={`${activeSpace.name} 역할 공간 설정`}>
      <div className="role-space-settings-heading">
        <label className="persona-guidance-field" htmlFor="role-space-name">
          <span>공간 이름</span>
          <input id="role-space-name" value={activeSpace.name} onChange={(event) => updateSpace(activeSpace.id, { name: event.target.value })} placeholder="예: 개발팀" />
        </label>
        <button className="session-row-action delete role-space-delete" type="button" title={activeSpace.profiles.length ? "페르소나가 없는 역할 공간만 삭제할 수 있습니다" : `${activeSpace.name} 삭제`} aria-label={activeSpace.profiles.length ? "페르소나가 없어야 역할 공간을 삭제할 수 있습니다" : `${activeSpace.name} 역할 공간 삭제`} disabled={activeSpace.profiles.length > 0} onClick={() => deleteSpace(activeSpace.id)}><Icon name="trash" /></button>
      </div>
      {activeSpace.profiles.length > 0 && <p className="role-space-delete-hint">페르소나를 모두 삭제하면 역할 공간을 삭제할 수 있습니다.</p>}

      <div className="role-space-permissions" aria-label="공간 권한">
        <div className="persona-profiles-heading"><div><b>A2A 및 A2B 권한</b><small>공간 안의 모든 페르소나에 적용됩니다.</small></div></div>
        <p className="role-space-permission-note">권한을 끄면 해당 방식의 새 요청을 거부합니다. 이미 접수된 작업의 답장과 결과 전달은 계속 허용됩니다.</p>
        <label className="settings-preference-row role-space-permission">
          <div><b>A2A 위임</b><p>다른 에이전트에 비동기 작업을 요청합니다.</p></div>
          <input type="checkbox" checked={activeSpace.permissions.a2a} onChange={(event) => updateSpace(activeSpace.id, { permissions: { ...activeSpace.permissions, a2a: event.target.checked } })} />
        </label>
        <label className="settings-preference-row role-space-permission">
          <div><b>A2B 요청</b><p>지정한 에이전트 하나에 작업을 맡깁니다.</p></div>
          <input type="checkbox" checked={activeSpace.permissions.a2b} onChange={(event) => updateSpace(activeSpace.id, { permissions: { ...activeSpace.permissions, a2b: event.target.checked } })} />
        </label>
      </div>

      <div className="role-space-personas">
        <div className="persona-profiles-heading role-space-persona-heading">
          <div><b>이 공간의 페르소나</b><small>페르소나를 선택하면 별도 페이지에서 편집합니다.</small></div>
          <button className="toolbar-button subtle persona-add-button" type="button" onClick={() => onAddPersona(activeSpace.id)}><Icon name="plus" />추가</button>
        </div>
        {activeSpace.profiles.length ? <div className="persona-profile-items">
          {activeSpace.profiles.map((profile) => {
            const selected = profile.id === selectedProfileId;
            return <div className={`persona-profile-row${selected ? " active" : ""}`} key={profile.id}>
              <button className="persona-profile-select" type="button" onClick={() => onOpenPersona(profile.id)}>
                <Icon name="sparkles" />
                <span>{profile.name.trim() || "이름 없는 페르소나"}</span>
                {selected && <small>선택 중</small>}
              </button>
              <button className="session-row-action delete persona-profile-delete" type="button" title={`${profile.name || "페르소나"} 삭제`} aria-label={`${profile.name || "페르소나"} 삭제`} onClick={() => deleteProfile(profile.id)}><Icon name="trash" /></button>
            </div>;
          })}
        </div> : <p className="persona-profiles-empty">아직 페르소나가 없습니다. 추가 버튼으로 만들어 보세요.</p>}
      </div>
    </section> : <div className="feature-empty role-space-empty">
      <Icon name="sparkles" />
      <h2>역할 공간이 없습니다</h2>
      <p>역할 공간을 만든 뒤 이름과 A2A 및 A2B 권한을 설정할 수 있습니다.</p>
      <button className="toolbar-button subtle" type="button" onClick={() => addSpace()}><Icon name="plus" />역할 공간 추가</button>
    </div>}
  </section>;
}
