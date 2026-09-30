import type { ReactNode, Ref } from "react";
import { Icon } from "../../shared/Icon";
import { providerDisplayName } from "../../shared/provider-display-name";
import { formatAge, groupThreads, type Project } from "./session-groups";
import type { AssistantProvider, RemoteThread } from "../../../shared/bridge";
import type { BridgeConnectionState } from "../../shared/provider-ui-state";
import type { DaemonConnection } from "../../../platform/daemon-connections";
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
    daemons: DaemonConnection[];
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
    openNewWorkspace: (target?: string) => void;
    openNewSession: (path: string, target?: string) => void;
    selectDaemon: (target: string) => void;
    manageDaemons?: () => void;
    renameDaemon?: (id: string) => void;
    refresh: () => void;
    openThread: (target: string, thread: RemoteThread) => void;
    openRenameSession: (thread: RemoteThread) => void;
    openDeleteSession: (thread: RemoteThread) => void;
    toggleProject: (key: string) => void;
    navigate: (page: AppPage) => void;
    openSettings: () => void;
  };
}) {
  const roots = daemonClientRoots(sessions.daemons, sessions.connectedTarget, sessions.threads, provider.daemonClient, provider.connectionState);

  const { activePage } = layout;
  const { assistantProviderName, daemonClient, connectionState } = provider;

  return (
    <aside ref={asideRef} id="workspace-sidebar" className={`sidebar workspace-sidebar ${layout.mobileSidebarOpen ? "mobile-open" : ""}`} aria-hidden={layout.sidebarA11yHidden} inert={layout.sidebarA11yHidden}>
      <div className="brand-row electrobun-webkit-app-region-drag">
        {gtk.leftControls}
        <div className="brand-row-actions">
          <button className="icon-button sidebar-action electrobun-webkit-app-region-no-drag" type="button" title="새 작업 공간" aria-label="새 작업 공간" onClick={() => actions.openNewWorkspace()} disabled={connectionState !== "connected" || sessions.creatingSession || sessions.openingThread}><Icon name="plus" /></button>
          {gtk.rightControls}
        </div>
      </div>
        <div className="sidebar-section-heading"><span>작업 공간</span><div className="sidebar-section-actions">{daemonClient && actions.manageDaemons && <button className="icon-button" title="데몬 추가 및 관리" aria-label="데몬 추가 및 관리" onClick={actions.manageDaemons}><Icon name="settings" /></button>}<button className="icon-button" title="새 작업 공간" aria-label="새 작업 공간" onClick={() => actions.openNewWorkspace()} disabled={connectionState !== "connected" || sessions.creatingSession}><Icon name="plus" /></button><button className="icon-button" title="세션 새로고침" onClick={actions.refresh} disabled={connectionState !== "connected"}><Icon name="refresh" /></button></div></div>
        <div className="project-list">
          {roots.map((root) => {
            const projects: Project[] = groupThreads(root.threads);
            const active = root.target === sessions.connectedTarget;
            const ready = root.state === "connected";
            const rootCollapsed = sessions.collapsedProjects.includes(root.target);
            return <div className={`daemon-root${active ? " active" : ""}`} key={root.target}>
              {daemonClient && <div className="daemon-root-heading">
                <button className="icon-button" type="button" onClick={() => actions.toggleProject(root.target)} aria-label={`${root.hostname} ${rootCollapsed ? "펼치기" : "접기"}`} aria-expanded={!rootCollapsed}><Icon name={rootCollapsed ? "chevron-right" : "chevron-down"} /></button>
                <button className="daemon-root-select" type="button" onClick={() => {
                  if (!active) actions.selectDaemon(root.target);
                  actions.toggleProject(root.target);
                }} disabled={!ready || sessions.openingThread || sessions.creatingSession} title={root.endpoint} aria-label={`${root.hostname} 작업 공간 ${rootCollapsed ? "펼치기" : "접기"}`} aria-pressed={active} aria-expanded={!rootCollapsed}><b>{root.hostname}</b><small>{ready ? "연결됨" : root.state === "connecting" ? "연결 중…" : "연결 안 됨"}</small></button>
                {actions.renameDaemon && <button className="session-row-action daemon-root-rename" type="button" title={`데몬 이름 수정: ${root.hostname}`} aria-label={`데몬 이름 수정: ${root.hostname}`} onClick={() => actions.renameDaemon?.(root.id)}><Icon name="edit" /></button>}
                <button className="icon-button" type="button" title={`${root.hostname}에 작업 공간 추가`} aria-label={`${root.hostname}에 작업 공간 추가`} disabled={!ready || sessions.creatingSession || sessions.openingThread} onClick={() => actions.openNewWorkspace(root.target)}><Icon name="plus" /></button>
              </div>}
              {!rootCollapsed && (projects.length ? projects.map((project) => {
            const collapsed = sessions.collapsedProjects.includes(`${root.target}:${project.key}`);
            return <section className="project-group" key={project.key}>
              <div className="project-heading" title={project.path}>
                <button className="project-heading-toggle" onClick={() => actions.toggleProject(`${root.target}:${project.key}`)} aria-label={`${project.name} 세션 ${collapsed ? "펼치기" : "접기"}`}>
                  <Icon name={collapsed ? "chevron-right" : "chevron-down"} /><Icon name="folder" /><b>{project.name}</b><span className="session-count">{project.sessions.length}</span>
                </button>
                <button className="project-new-session" title={`${project.name}에서 새 세션`} aria-label={`${project.name} 작업 공간에서 새 세션`} onClick={() => actions.openNewSession(project.path, root.target)} disabled={!ready || !project.path || sessions.creatingSession || sessions.openingThread}><Icon name="plus" /></button>
              </div>
              {!collapsed && <div className="session-list">{project.sessions.map((thread) => {
                const isSelected = active && thread.provider === provider.threadProvider && thread.id === sessions.chatRootThreadId;
                return <div key={`${thread.provider}:${thread.id}`} className={`session-row ${isSelected ? "selected" : ""}`}>
                  <button className={`session-item ${isSelected ? "selected" : ""}`} disabled={!ready || sessions.openingThread || sessions.creatingSession} onClick={() => actions.openThread(root.target, thread)}>
                    <span className="session-dot"><Icon name="message" /></span><span className="session-details"><b>{thread.title}</b><small>{providerDisplayName(thread.provider)} · {formatAge(thread.updatedAt)}</small></span>
                  </button>
                  <div className="session-row-actions">
                    <button className="session-row-action" type="button" title={`이름 수정: ${thread.title}`} aria-label={`세션 이름 수정: ${thread.title}`} onClick={() => actions.openRenameSession(thread)} disabled={!ready || !active || sessions.openingThread || sessions.renamingSession || sessions.deletingSession || sessions.creatingSession}><Icon name="edit" /></button>
                    <button className="session-row-action delete" type="button" title={`세션 삭제: ${thread.title}`} aria-label={`세션 삭제: ${thread.title}`} onClick={() => actions.openDeleteSession(thread)} disabled={!ready || !active || sessions.openingThread || sessions.deletingSession || sessions.creatingSession}><Icon name="trash" /></button>
                  </div>
                </div>;
              })}</div>}
            </section>;
          }) : <div className="sidebar-empty">{ready ? <><p>세션 목록이 비어 있습니다.</p><button className="toolbar-button subtle" onClick={() => actions.openNewWorkspace(root.target)} disabled={sessions.creatingSession || sessions.openingThread}><Icon name="plus" /> 새 작업 공간</button></> : <p>{daemonClient ? "데몬 관리에서 연결 상태를 확인하세요." : `${assistantProviderName} host를 연결하면 세션이 표시됩니다.`}</p>}</div>)}
            </div>;
          })}
          {daemonClient && !roots.length && <div className="sidebar-empty"><p>연결할 데몬을 추가하세요.</p><button className="toolbar-button subtle" onClick={actions.manageDaemons}>데몬 추가</button></div>}
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

function daemonClientRoots(daemons: DaemonConnection[], target: string, threads: RemoteThread[], daemonClient: boolean, state: BridgeConnectionState): DaemonConnection[] {
  return daemonClient ? daemons : [{ id: "direct", target, endpoint: target, hostname: target, state, error: "", threads }];
}
