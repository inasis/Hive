import { useMemo, type ReactNode, type Ref } from "react";
import { Icon } from "../../shared/Icon";
import { providerDisplayName } from "../../shared/provider-display-name";
import { formatAge, groupThreads, type Project } from "./session-groups";
import type { AssistantProvider, RemoteSkill, RemoteThread } from "../../../shared/bridge";
import type { BridgeConnectionState } from "../connection/connection-state";
import type { AppPage, SettingsSection } from "./workspace-types";

export function WorkspaceSidebar({ asideRef, layout, provider, sessions, skills, settings, gtk, actions }: {
  asideRef: Ref<HTMLElement>;
  layout: {
    activePage: AppPage;
    mobileSidebarOpen: boolean;
    sidebarA11yHidden: boolean;
  };
  provider: {
    assistantProvider: AssistantProvider;
    assistantProviderName: string;
    threadProvider: AssistantProvider;
    threadProviderName: string;
    daemonClient: boolean;
    connectionState: BridgeConnectionState;
  };
  sessions: {
    threads: RemoteThread[];
    connectedTarget: string;
    chatRootThreadId: string;
    collapsedProjects: string[];
    creatingSession: boolean;
    openingThread: boolean;
    renamingSession: boolean;
    deletingSession: boolean;
  };
  skills: {
    items: RemoteSkill[];
    selectedProvider: string;
  };
  settings: { section: SettingsSection };
  gtk: { leftControls?: ReactNode; rightControls?: ReactNode };
  actions: {
    openNewWorkspace: () => void;
    openNewSession: (path: string) => void;
    refresh: () => void;
    openThread: (target: string, thread: RemoteThread) => void;
    openRenameSession: (thread: RemoteThread) => void;
    openDeleteSession: (thread: RemoteThread) => void;
    toggleProject: (key: string) => void;
    navigate: (page: AppPage) => void;
    openSettings: () => void;
    changeSettingsSection: (section: SettingsSection) => void;
    changeSkillProvider: (provider: string) => void;
    closeMobileSidebar: () => void;
  };
}) {
  const projects: Project[] = useMemo(() => groupThreads(sessions.threads), [sessions.threads]);
  const providers = useMemo(() => ["전체 제공자", ...new Set(skills.items.map((skill) => skill.provider))], [skills.items]);
  const { activePage } = layout;
  const { assistantProviderName, threadProviderName, daemonClient, connectionState } = provider;

  return (
    <aside ref={asideRef} id="workspace-sidebar" className={`sidebar ${activePage === "sessions" ? "sessions-sidebar" : activePage === "skills" ? "skills-sidebar" : "settings-sidebar"} ${layout.mobileSidebarOpen ? "mobile-open" : ""}`} aria-hidden={layout.sidebarA11yHidden} inert={layout.sidebarA11yHidden}>
      <div className="brand-row electrobun-webkit-app-region-drag">
        {gtk.leftControls}
        <div className="brand-row-actions">
          <button className="icon-button sidebar-action electrobun-webkit-app-region-no-drag" type="button" title="새 워크스페이스" aria-label="새 워크스페이스" onClick={actions.openNewWorkspace} disabled={connectionState !== "connected" || sessions.creatingSession || sessions.openingThread}><Icon name="plus" /></button>
          {gtk.rightControls}
        </div>
      </div>
      <nav className="app-nav" aria-label="주 메뉴">
        <button className={activePage === "sessions" ? "app-nav-item active" : "app-nav-item"} onClick={() => actions.navigate("sessions")}><Icon name="message" /><span>세션</span></button>
        <button className={activePage === "skills" ? "app-nav-item active" : "app-nav-item"} onClick={() => actions.navigate("skills")}><Icon name="sparkles" /><span>스킬</span><small>{skills.items.length}</small></button>
        <button className={activePage === "settings" ? "app-nav-item active" : "app-nav-item"} onClick={actions.openSettings}><Icon name="settings" /><span>설정</span></button>
      </nav>

      {activePage === "sessions" && <>
        <div className="sidebar-section-heading"><span>WORKSPACES</span><div className="sidebar-section-actions"><button className="icon-button" title="새 워크스페이스" aria-label="새 워크스페이스" onClick={actions.openNewWorkspace} disabled={connectionState !== "connected" || sessions.creatingSession}><Icon name="plus" /></button><button className="icon-button" title="세션 새로고침" onClick={actions.refresh} disabled={connectionState !== "connected"}><Icon name="refresh" /></button></div></div>
        <div className="project-list">
          {projects.length ? projects.map((project) => {
            const collapsed = sessions.collapsedProjects.includes(project.key);
            return <section className="project-group" key={project.key}>
              <div className="project-heading" title={project.path}>
                <button className="project-heading-toggle" onClick={() => actions.toggleProject(project.key)} aria-label={`${project.name} 세션 ${collapsed ? "펼치기" : "접기"}`}>
                  <Icon name={collapsed ? "chevron-right" : "chevron-down"} /><Icon name="folder" /><b>{project.name}</b><span className="session-count">{project.sessions.length}</span>
                </button>
                <button className="project-new-session" title={`${project.name}에서 새 세션`} aria-label={`${project.name} 워크스페이스에서 새 세션`} onClick={() => actions.openNewSession(project.path)} disabled={!project.path || sessions.creatingSession || sessions.openingThread}><Icon name="plus" /></button>
              </div>
              {!collapsed && <div className="session-list">{project.sessions.map((thread) => {
                const isSelected = thread.provider === provider.threadProvider && thread.id === sessions.chatRootThreadId;
                return <div key={`${thread.provider}:${thread.id}`} className={`session-row ${isSelected ? "selected" : ""}`}>
                  <button className={`session-item ${isSelected ? "selected" : ""}`} onClick={() => actions.openThread(sessions.connectedTarget, thread)}>
                    <span className="session-dot"><Icon name="message" /></span><span className="session-details"><b>{thread.title}</b><small>{providerDisplayName(thread.provider)} · {formatAge(thread.updatedAt)}</small></span>
                  </button>
                  <div className="session-row-actions">
                    <button className="session-row-action" type="button" title={`이름 수정: ${thread.title}`} aria-label={`세션 이름 수정: ${thread.title}`} onClick={() => actions.openRenameSession(thread)} disabled={sessions.renamingSession || sessions.deletingSession || sessions.creatingSession}><Icon name="edit" /></button>
                    <button className="session-row-action delete" type="button" title={`세션 삭제: ${thread.title}`} aria-label={`세션 삭제: ${thread.title}`} onClick={() => actions.openDeleteSession(thread)} disabled={sessions.deletingSession || sessions.creatingSession}><Icon name="trash" /></button>
                  </div>
                </div>;
              })}</div>}
            </section>;
          }) : <div className="sidebar-empty">{connectionState === "connected" ? <><p>세션 목록이 비어 있습니다.</p><button className="toolbar-button subtle" onClick={actions.openNewWorkspace} disabled={sessions.creatingSession}><Icon name="plus" /> 새 워크스페이스</button></> : daemonClient ? `데몬의 ${assistantProviderName}에 연결하면 세션이 표시됩니다.` : `${assistantProviderName} host를 연결하면 세션이 표시됩니다.`}</div>}
        </div>
      </>}
      {activePage === "skills" && <div className="context-sidebar skills-context">
        <div className="context-heading"><span>SKILL CATALOG</span><b>{skills.items.length.toString().padStart(2, "0")}</b></div>
        <p>현재 {threadProviderName} 호스트와 세션에서 사용할 수 있는 도구입니다.</p>
        <div className="provider-list" aria-label="제공자 필터">
          {providers.map((name) => <button key={name} className={skills.selectedProvider === name ? "provider-filter active" : "provider-filter"} onClick={() => actions.changeSkillProvider(name)}><span>{name === "전체 제공자" ? <Icon name="sparkles" /> : <span className="provider-glyph">{name.slice(0, 1).toUpperCase()}</span>}{name}</span><small>{name === "전체 제공자" ? skills.items.length : skills.items.filter((skill) => skill.provider === name).length}</small></button>)}
        </div>
        <div className="context-sidebar-note"><span className={connectionState === "connected" ? "status-green" : "status-green preview-led"} />{connectionState === "connected" ? "원격 카탈로그 동기화됨" : "호스트 연결 필요"}</div>
      </div>}
      {activePage === "settings" && <div className="context-sidebar settings-context">
        <div className="context-heading"><span>APP SETTINGS</span></div>
        <p>연결 정보와 화면 테마를 관리합니다.</p>
        <nav className="settings-section-nav" aria-label="설정 페이지">
          <button type="button" className={settings.section === "connection" ? "settings-section-item active" : "settings-section-item"} onClick={() => { actions.changeSettingsSection("connection"); actions.closeMobileSidebar(); }}><Icon name="branch" /><span>연결</span>{connectionState === "connected" && <small>연결됨</small>}</button>
          <button type="button" className={settings.section === "theme" ? "settings-section-item active" : "settings-section-item"} onClick={() => { actions.changeSettingsSection("theme"); actions.closeMobileSidebar(); }}><Icon name="sun" /><span>테마</span></button>
        </nav>
      </div>}
    </aside>
  );
}
