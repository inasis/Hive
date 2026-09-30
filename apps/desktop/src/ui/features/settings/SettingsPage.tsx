import type { FormEvent } from "react";
import type { AssistantProvider, AssistantProviderInfo } from "../../../../../../src/domain/provider-catalog.js";
import { Icon } from "../../shared/Icon";
import { isRelayWorkspaceTarget } from "../../shared/workspace-target-label";
import type { ThemeMode } from "./settings-types";
import type { ConnectionPresentation } from "../../shared/connection-presentation";

export function McpSettingsPage() {
  return <section className="feature-page settings-page mcp-settings-page">
    <div className="feature-heading"><span className="eyebrow">SETTINGS / MCP</span><h1>MCP</h1><p>Hive A2A MCP 도구 연결 정보를 확인합니다.</p></div>
    <section className="settings-panel mcp-settings-panel" aria-labelledby="hive-mcp-title">
      <div className="settings-panel-heading"><div><span className="eyebrow">BUILT-IN SERVER</span><h2 id="hive-mcp-title">Hive A2A MCP</h2></div></div>
      <p className="mcp-settings-description">Hive 데몬은 지원되는 Codex, OpenCode, Kiro 세션에 에이전트 검색과 작업 위임 도구를 제공합니다.</p>
      <div className="mcp-tool-list" aria-label="제공 도구">
        <article className="mcp-tool-card"><code>a2a_list_agents</code><p>현재 Hive room에서 사용할 수 있는 에이전트를 조회합니다.</p></article>
        <article className="mcp-tool-card"><code>a2a_send</code><p>다른 세션에 비동기 작업을 보내고, 완료 결과를 원래 요청자에게 돌려줍니다.</p></article>
      </div>
      <p className="mcp-settings-note">도구 노출 여부는 provider 연결 방식, 세션 권한, MCP 주입 지원 여부에 따라 달라집니다.</p>
    </section>
  </section>;
}

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

export function ProviderSettingsPage({ provider, providerOptions, busy, onProviderChange }: {
  provider: AssistantProvider;
  providerOptions: AssistantProviderInfo[];
  busy: boolean;
  onProviderChange: (provider: AssistantProvider) => void;
}) {
  const handleProviderChange = (value: string) => {
    const selected = providerOptions.find((option) => option.id === value);
    if (selected) onProviderChange(selected.id);
  };
  return <section className="feature-page settings-page provider-settings-page">
    <div className="feature-heading"><span className="eyebrow">SETTINGS / PROVIDER</span><h1>Provider</h1><p>Hive에서 사용할 AI 코딩 provider를 선택합니다.</p></div>
    <section className="settings-panel provider-settings-panel" aria-labelledby="provider-settings-title">
      <div className="settings-panel-heading"><div><span className="eyebrow">ASSISTANT PROVIDER</span><h2 id="provider-settings-title">현재 Provider</h2></div></div>
      <label htmlFor="assistant-provider">Provider</label>
      <select id="assistant-provider" value={provider} disabled={busy} onChange={(event) => handleProviderChange(event.target.value)}>
        {providerOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      <p className="dialog-help">Provider를 변경하면 해당 provider의 세션 목록과 연결 설정을 사용합니다.</p>
    </section>
  </section>;
}

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
        {onOpenProviderSettings && <button className="dialog-secondary daemon-settings-change" onClick={onOpenProviderSettings}>Provider 설정</button>}
        {daemonClient && onOpenDaemonSettings && <button className="dialog-secondary daemon-settings-change" onClick={onOpenDaemonSettings}>데몬 관리</button>}
        {onUseDirectConnection && <button className="dialog-secondary" onClick={onUseDirectConnection}>SSH 또는 릴레이로 직접 연결</button>}
        {onUseDaemonConnection && <button className="dialog-secondary" onClick={onUseDaemonConnection}>Hive 데몬에 연결</button>}
      </aside>
    </div>
  </section>;
}
