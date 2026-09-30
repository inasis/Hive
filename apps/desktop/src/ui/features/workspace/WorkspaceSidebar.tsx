import type { ReactNode, Ref } from "react";
import { Icon } from "../../shared/Icon";
import { providerDisplayName } from "../../shared/provider-display-name";
import { formatAge, groupThreads, type Project } from "./session-groups";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { AppPage } from "../../shared/workspace-state";

export function WorkspaceSidebar({ asideRef, layout, provider, sessions, gtk, actions }: {
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
  };
}) {
  const projects: Project[] = groupThreads(sessions.threads);
  const { activePage } = layout;
  const { assistantProviderName, daemonClient, connectionState } = provider;

  return (
    <aside ref={asideRef} id="workspace-sidebar" className={`sidebar workspace-sidebar ${layout.mobileSidebarOpen ? "mobile-open" : ""}`} aria-hidden={layout.sidebarA11yHidden} inert={layout.sidebarA11yHidden}>
      <div className="brand-row electrobun-webkit-app-region-drag">
        {gtk.leftControls}
        <div className="brand-row-actions">
          <button className="icon-button sidebar-action electrobun-webkit-app-region-no-drag" type="button" title="새 작업 공간" aria-label="새 작업 공간" onClick={actions.openNewWorkspace} disabled={connectionState !== "connected" || sessions.creatingSession || sessions.openingThread}><Icon name="plus" /></button>
          {gtk.rightControls}
        </div>
      </div>
        <div className="sidebar-section-heading"><span>작업 공간</span><div className="sidebar-section-actions"><button className="icon-button" title="새 작업 공간" aria-label="새 작업 공간" onClick={actions.openNewWorkspace} disabled={connectionState !== "connected" || sessions.creatingSession}><Icon name="plus" /></button><button className="icon-button" title="세션 새로고침" onClick={actions.refresh} disabled={connectionState !== "connected"}><Icon name="refresh" /></button></div></div>
        <div className="project-list">
          {projects.length ? projects.map((project) => {
            const collapsed = sessions.collapsedProjects.includes(project.key);
            return <section className="project-group" key={project.key}>
              <div className="project-heading" title={project.path}>
                <button className="project-heading-toggle" onClick={() => actions.toggleProject(project.key)} aria-label={`${project.name} 세션 ${collapsed ? "펼치기" : "접기"}`}>
                  <Icon name={collapsed ? "chevron-right" : "chevron-down"} /><Icon name="folder" /><b>{project.name}</b><span className="session-count">{project.sessions.length}</span>
                </button>
                <button className="project-new-session" title={`${project.name}에서 새 세션`} aria-label={`${project.name} 작업 공간에서 새 세션`} onClick={() => actions.openNewSession(project.path)} disabled={!project.path || sessions.creatingSession || sessions.openingThread}><Icon name="plus" /></button>
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
          }) : <div className="sidebar-empty">{connectionState === "connected" ? <><p>세션 목록이 비어 있습니다.</p><button className="toolbar-button subtle" onClick={actions.openNewWorkspace} disabled={sessions.creatingSession}><Icon name="plus" /> 새 작업 공간</button></> : daemonClient ? `데몬의 ${assistantProviderName}에 연결하면 세션이 표시됩니다.` : `${assistantProviderName} host를 연결하면 세션이 표시됩니다.`}</div>}
        </div>
      <div className="sidebar-settings-footer">
        <button
          className={`icon-button sidebar-settings-entry${activePage === "settings" ? " active" : ""}`}
          type="button"
          title={activePage === "settings" ? "작업 공간" : "설정"}
          aria-label={activePage === "settings" ? "작업 공간으로 돌아가기" : "설정 열기"}
          aria-current={activePage === "settings" ? "page" : undefined}
          onClick={activePage === "settings" ? () => actions.navigate("sessions") : actions.openSettings}
        ><Icon name="settings" /></button>
      </div>
    </aside>
  );
}
