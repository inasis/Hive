import type { AssistantProvider, AssistantProviderInfo, RemotePermissionPreset } from "../../../shared/bridge";
import { Icon } from "../../shared/Icon";
import { assistantProviderSupports } from "../../../../../../src/domain/provider-catalog.js";
import type { BridgeConnectionState } from "../connection/connection-state";

type Props = {
  state: {
    open: boolean;
    mode: "workspace" | "session";
    path: string;
    name: string;
    permissionPresets: string[];
    error: string;
    creating: boolean;
    choosingWorkspaceFolder: boolean;
    busy: boolean;
  };
  provider: {
    current: AssistantProvider;
    name: string;
    options: AssistantProviderInfo[];
    permissionPresets: RemotePermissionPreset[];
    connectionState: BridgeConnectionState;
    connectedProvider: AssistantProvider;
  };
  platform: { linuxDesktop: boolean; daemonClient: boolean };
  actions: {
    close: () => void;
    submit: () => void;
    chooseProvider: (provider: AssistantProvider) => void;
    changePath: (path: string) => void;
    changeName: (name: string) => void;
    changePermissionPresets: (update: (current: string[]) => string[]) => void;
    chooseWorkspaceFolder: () => void;
  };
};

export function NewSessionDialog({ state, provider, platform, actions }: Props) {
  if (!state.open) return null;
  const isWorkspace = state.mode === "workspace";
  const workspaceName = state.path.split(/[\\/]/).filter(Boolean).at(-1) || "워크스페이스";
  const waitingForConnection = provider.connectionState !== "connected" || provider.connectedProvider !== provider.current;
  const createsWithPermissionProfiles = assistantProviderSupports(provider.current, "permissionProfileCreation");

  return <div className="dialog-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !state.creating) actions.close();
  }}>
    <form className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="new-session-dialog-title" onSubmit={(event) => { event.preventDefault(); actions.submit(); }}>
      <div className="dialog-mark"><Icon name="plus" /></div>
      <h2 id="new-session-dialog-title">{isWorkspace ? "새 워크스페이스" : "새 세션"}</h2>
      <p>{isWorkspace ? "작업할 폴더를 선택하고 프로바이더를 정해 새 워크스페이스를 시작하세요." : `같은 ${workspaceName} 폴더에서 선택한 프로바이더로 새 대화를 시작하세요.`}</p>
      <label htmlFor="new-session-provider">프로바이더</label>
      <select id="new-session-provider" aria-label="새 세션 프로바이더 선택" value={provider.current} disabled={state.creating || state.busy} onChange={(event) => actions.chooseProvider(event.target.value as AssistantProvider)}>
        {provider.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      <label htmlFor="new-session-name">{isWorkspace ? "첫 세션 이름 (선택)" : "세션 이름 (선택)"}</label>
      <input id="new-session-name" value={state.name} onChange={(event) => actions.changeName(event.target.value)} placeholder={`비워 두면 ${provider.name}가 자동으로 정합니다`} maxLength={120} disabled={state.creating} />
      {createsWithPermissionProfiles && provider.permissionPresets.length > 0 && <fieldset className="permission-presets"><legend>{provider.name} 시작 권한 (선택)</legend>
        {provider.permissionPresets.map((preset) => <label key={preset.id} title={preset.description}><input type="checkbox" checked={state.permissionPresets.includes(preset.id)} disabled={state.creating} onChange={(event) => actions.changePermissionPresets((current) => event.target.checked ? [...current, preset.id] : current.filter((id) => id !== preset.id))} /><span><b>{preset.label}</b><small>{preset.description}</small></span></label>)}
        <p>선택한 권한은 추가 허용 규칙으로 적용됩니다. 비워 두면 {provider.name} 기본 승인 흐름을 사용하며, 거부 규칙은 허용 규칙보다 우선합니다.</p>
      </fieldset>}
      <label htmlFor="new-session-path">{isWorkspace ? "워크스페이스 폴더" : "현재 워크스페이스 폴더"}</label>
      <div className="workspace-folder-field">
        <input id="new-session-path" value={state.path} onChange={(event) => actions.changePath(event.target.value)} placeholder="/home/user/project" autoFocus disabled={!isWorkspace || state.creating || state.choosingWorkspaceFolder} />
        {platform.daemonClient && platform.linuxDesktop && isWorkspace && <button className="dialog-secondary" type="button" onClick={actions.chooseWorkspaceFolder} disabled={state.creating || state.choosingWorkspaceFolder}><Icon name={state.choosingWorkspaceFolder ? "refresh" : "folder"} />{state.choosingWorkspaceFolder ? "폴더 여는 중…" : "폴더 선택"}</button>}
      </div>
      {state.error && <div className="connection-error">{state.error}</div>}
      {waitingForConnection && <div className="connection-error">{provider.connectionState === "connecting" ? `${provider.name}에 연결 중입니다…` : `${provider.name} 연결이 완료되면 시작할 수 있습니다.`}</div>}
      <div className="dialog-help">{isWorkspace ? "선택한 폴더를 워크스페이스로 사용하고 첫 세션을 만듭니다." : "선택한 워크스페이스 폴더에 새 세션을 추가합니다. 기존 세션과 대화 기록은 그대로 유지됩니다."}</div>
      <div className="dialog-actions">
        <button type="button" className="dialog-secondary" onClick={actions.close} disabled={state.creating || state.choosingWorkspaceFolder}>취소</button>
        <button type="submit" className="dialog-primary" disabled={!state.path.trim() || waitingForConnection || state.creating || state.choosingWorkspaceFolder}>{state.creating ? "시작하는 중…" : isWorkspace ? "워크스페이스 시작" : "세션 시작"}</button>
      </div>
    </form>
  </div>;
}
