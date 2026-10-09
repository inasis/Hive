import type { FormEvent } from "react";
import { Icon } from "../../shared/Icon";
import type { ConnectionPresentation } from "../../shared/connection-presentation";

export function ConnectionSettingsPage({
  presentation,
  providerName,
  daemonClient,
  target,
  workspaceHost,
  connectionState,
  notice,
  modelWarning,
  onTargetChange,
  onConnect,
  onDisconnect,
  onOpenProviderSettings,
  onOpenDaemonSettings,
  onUseDirectConnection,
  onUseDaemonConnection,
}: {
  presentation: ConnectionPresentation;
  providerName: string;
  daemonClient: boolean;
  target: string;
  workspaceHost: string;
  connectionState: "disconnected" | "connecting" | "connected";
  notice: string;
  modelWarning: string;
  onTargetChange: (target: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenProviderSettings?: () => void;
  onOpenDaemonSettings?: () => void;
  onUseDirectConnection?: () => void;
  onUseDaemonConnection?: () => void;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConnect();
  };
  const connectionActions = <div className="connection-form-actions">
    <button
      type={daemonClient ? "button" : "submit"}
      className="dialog-primary"
      onClick={daemonClient ? onConnect : undefined}
      disabled={connectionState === "connecting"}
    >
      {connectionState === "connecting"
        ? "연결 중…"
        : daemonClient && connectionState === "connected"
          ? "세션 목록 새로고침"
          : daemonClient ? `${providerName} 연결` : "연결 및 세션 불러오기"}
    </button>
    {connectionState === "connected" && <button type="button" className="dialog-secondary" onClick={onDisconnect}>연결 끊기</button>}
  </div>;
  const formContents = <>
    <div className="connection-card-heading"><div className="connection-card-icon"><Icon name="branch" /></div><div><h2>{presentation.formTitle}</h2><p>{presentation.formDescription}</p></div></div>
    {!daemonClient && <>
      <label htmlFor="ssh-target">작업공간 host (선택)</label>
      <input
        id="ssh-target"
        value={target}
        onChange={(event) => onTargetChange(event.target.value)}
        placeholder="로컬은 비워 두기 · 또는 user@host"
        disabled={connectionState === "connecting"}
      />
    </>}
    <div className="dialog-help">{presentation.formHelp}</div>
    {notice && connectionState !== "connected" && <div className="connection-error">{notice}</div>}
    {modelWarning && <div className="skill-warning">{modelWarning}</div>}
    {connectionActions}
  </>;

  return <section className="feature-page connection-page">
    <div className="feature-heading"><span className="eyebrow">SETTINGS / CONNECTION</span><h1>연결</h1><p>{presentation.pageDescription}</p></div>
    <div className="connection-layout">
      {daemonClient
        ? <div className="connection-form-card">{formContents}</div>
        : <form className="connection-form-card" onSubmit={handleSubmit}>{formContents}</form>}
      <aside className="connection-info-card">
        <span className="eyebrow">CONNECTION STATUS</span>
        <div className={`connection-large-status ${connectionState}`}><i />{connectionState === "connected" ? "연결됨" : connectionState === "connecting" ? "연결 중" : "연결되지 않음"}</div>
        <dl>
          <dt>Provider</dt><dd>{presentation.providerKind}</dd>
          <dt>작업공간 host</dt><dd>{workspaceHost}</dd>
          <dt>Provider 설정</dt><dd>{presentation.runtimeLabel}</dd>
        </dl>
        <p>{presentation.statusDescription}</p>
        {onOpenProviderSettings && <button className="dialog-secondary daemon-settings-change" onClick={onOpenProviderSettings}>Provider 설정</button>}
        {daemonClient && onOpenDaemonSettings && <button className="dialog-secondary daemon-settings-change" onClick={onOpenDaemonSettings}>서버 관리</button>}
        {onUseDirectConnection && <button className="dialog-secondary" onClick={onUseDirectConnection}>SSH로 직접 연결</button>}
        {onUseDaemonConnection && <button className="dialog-secondary" onClick={onUseDaemonConnection}>Hive 서버에 연결</button>}
      </aside>
    </div>
  </section>;
}
