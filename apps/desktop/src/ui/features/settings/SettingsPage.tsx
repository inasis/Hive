import type { FormEvent } from "react";
import type { AssistantProvider, AssistantProviderInfo } from "../../../../../../src/domain/provider-catalog.js";
import { Icon } from "../../shared/Icon";
import { isRelayWorkspaceTarget } from "../connection/workspace-target-label";
import type { ConnectionPresentation, ThemeMode } from "./settings-types";

export function ThemeSettingsPage({ theme, onToggleTheme }: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  return <section className="feature-page settings-page">
    <div className="feature-heading"><span className="eyebrow">SETTINGS / THEME</span><h1>테마</h1><p>Hive 앱의 화면 표시 방식을 설정합니다.</p></div>
    <section className="settings-panel" aria-labelledby="appearance-settings-title">
      <div className="settings-panel-heading"><div><span className="eyebrow">APPEARANCE</span><h2 id="appearance-settings-title">화면 모드</h2></div></div>
      <div className="settings-preference-row"><div><b>테마</b><p>{theme === "dark" ? "어두운 화면으로 표시합니다." : "밝은 화면으로 표시합니다."}</p></div>
        <button
          className="theme-toggle settings-theme-toggle"
          type="button"
          role="switch"
          aria-checked={theme === "dark"}
          aria-label={theme === "dark" ? "다크 모드" : "라이트 모드"}
          title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          onClick={onToggleTheme}
        >
          <Icon name={theme === "dark" ? "moon" : "sun"} />
          <span>{theme === "dark" ? "다크 모드" : "라이트 모드"}</span>
          <span className="theme-switch-track" aria-hidden="true"><span /></span>
        </button>
      </div>
    </section>
  </section>;
}

export function ConnectionSettingsPage({
  presentation,
  providerName,
  providerOptions,
  daemonClient,
  provider,
  target,
  workspaceHost,
  connectionState,
  busy,
  notice,
  modelWarning,
  onProviderChange,
  onTargetChange,
  onConnect,
  onDisconnect,
  onMobileDisconnect,
  onUseDirectConnection,
  onUseDaemonConnection,
}: {
  presentation: ConnectionPresentation;
  providerName: string;
  providerOptions: AssistantProviderInfo[];
  daemonClient: boolean;
  provider: AssistantProvider;
  target: string;
  workspaceHost: string;
  connectionState: "disconnected" | "connecting" | "connected";
  busy: boolean;
  notice: string;
  modelWarning: string;
  onProviderChange: (provider: AssistantProvider) => void;
  onTargetChange: (target: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onMobileDisconnect?: () => void;
  onUseDirectConnection?: () => void;
  onUseDaemonConnection?: () => void;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConnect();
  };
  const handleProviderChange = (value: string) => {
    const selected = providerOptions.find((option) => option.id === value);
    if (selected) onProviderChange(selected.id);
  };
  const providerSelect = <>
    <label htmlFor="assistant-provider">Provider</label>
    <select id="assistant-provider" value={provider} disabled={busy} onChange={(event) => handleProviderChange(event.target.value)}>
      {providerOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  </>;
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
    {providerSelect}
    {!daemonClient && <>
      <label htmlFor="ssh-target">작업공간 host (선택)</label>
      <input
        id="ssh-target"
        type={isRelayWorkspaceTarget(target) ? "password" : "text"}
        value={target}
        onChange={(event) => onTargetChange(event.target.value)}
        placeholder="로컬은 비워 두기 · 또는 user@host / hive+tcp://…"
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
        {onMobileDisconnect && <button className="dialog-secondary mobile-change-desktop" onClick={onMobileDisconnect}>데몬 연결 설정 변경</button>}
        {onUseDirectConnection && <button className="dialog-secondary" onClick={onUseDirectConnection}>SSH 또는 릴레이로 직접 연결</button>}
        {onUseDaemonConnection && <button className="dialog-secondary" onClick={onUseDaemonConnection}>Hive 데몬에 연결</button>}
      </aside>
    </div>
  </section>;
}
