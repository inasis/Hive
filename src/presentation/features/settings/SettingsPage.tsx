import type { AssistantProvider } from "../../../domain/provider-catalog.js";
import type { AssistantProviderInfo } from "../../shared/bridge";
import { Icon } from "../../shared/Icon";
import type { ThemeMode } from "./settings-types";

export function McpSettingsPage() {
  return <section className="feature-page settings-page mcp-settings-page">
    <div className="feature-heading"><span className="eyebrow">SETTINGS / MCP</span><h1>MCP</h1><p>Hive A2A MCP 도구 연결 정보를 확인합니다.</p></div>
    <section className="settings-panel mcp-settings-panel" aria-labelledby="hive-mcp-title">
      <div className="settings-panel-heading"><div><span className="eyebrow">BUILT-IN SERVER</span><h2 id="hive-mcp-title">Hive A2A MCP</h2></div></div>
      <p className="mcp-settings-description">Hive A2A MCP는 지원되는 Codex, OpenCode, Pi, Kiro 세션에 에이전트 검색과 작업 위임 도구를 제공합니다.</p>
      <div className="mcp-tool-list" aria-label="제공 도구">
        <article className="mcp-tool-card"><code>a2a_list</code><p>먼저 호출해 받는 세션을 찾고, 결과의 <code>targetAgent</code> 값을 <code>a2a_send</code> 또는 <code>a2b_send</code>에 그대로 복사합니다.</p></article>
        <article className="mcp-tool-card"><code>a2a_send</code><p><code>targetAgent</code>와 메시지로 새 작업을 보내거나, 현재 task ID를 더해 결과를 다른 agent로 전달합니다.</p></article>
        <article className="mcp-tool-card"><code>a2a_reply</code><p>현재 task ID를 <code>replyToTaskId</code>로 보내면 Hive가 발신자에게 답장을 전달합니다.</p></article>
        <article className="mcp-tool-card"><code>a2b_send</code><p><code>a2a_list</code>에서 고른 <code>targetAgent</code> 하나에 Bonded 작업을 보냅니다. 수신 agent가 직접 답하고 다른 agent에 위임하지 않습니다.</p></article>
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
