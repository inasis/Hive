import { useState, useSyncExternalStore, type FormEvent, type MouseEvent } from "react";
import { daemonConnections } from "../../bridgeClient";
import { Icon } from "../../shared/Icon";

export function DaemonManagementSettingsPage() {
  const connections = useSyncExternalStore(daemonConnections.subscribe, daemonConnections.snapshot);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");

  const addDaemon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdding(true);
    setError("");
    try {
      await daemonConnections.add({ endpoint, token, fingerprint });
      setEndpoint("");
      setToken("");
      setFingerprint("");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setAdding(false); }
  };
  const retry = (id: string) => {
    setError("");
    void daemonConnections.connect(id).catch((reason: unknown) => setError(errorMessage(reason)));
  };
  const openRename = (id: string, name: string) => {
    setRenameTarget({ id, name });
    setRenameName(name);
    setRenameError("");
  };
  const closeRename = () => {
    setRenameTarget(null);
    setRenameError("");
  };
  const saveRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;
    try {
      daemonConnections.rename(renameTarget.id, renameName);
      closeRename();
    } catch (reason) { setRenameError(errorMessage(reason)); }
  };
  const closeRenameOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeRename();
  };

  return <>
    <section className="feature-page settings-page daemon-settings-page">
      <div className="feature-heading"><span className="eyebrow">SETTINGS / DAEMONS</span><h1>데몬 관리</h1><p>연결할 데몬을 추가하고, 저장된 데몬의 이름과 연결 상태를 관리합니다.</p></div>
      <section className="settings-panel daemon-settings-panel" aria-labelledby="daemon-settings-list-title">
        <div className="settings-panel-heading"><div><span className="eyebrow">SAVED DAEMONS</span><h2 id="daemon-settings-list-title">등록된 데몬</h2></div></div>
        {connections.length ? <div className="daemon-manager-list">{connections.map((connection) => <section className="daemon-manager-item" key={connection.id}>
          <div><b>{connection.hostname}</b><small>{connection.endpoint}</small><span>{connection.state === "connected" ? "연결됨" : connection.state === "connecting" ? "연결 중…" : "연결 안 됨"}</span></div>
          <div className="daemon-manager-actions">
            <button type="button" className="dialog-secondary daemon-manager-rename" onClick={() => openRename(connection.id, connection.hostname)}><Icon name="edit" />이름 변경</button>
            {connection.state === "disconnected" ? <button type="button" className="dialog-secondary" onClick={() => retry(connection.id)}>다시 연결</button> : <button type="button" className="dialog-secondary" onClick={() => daemonConnections.disconnect(connection.id)}>연결 종료</button>}
            <button type="button" className="dialog-secondary" onClick={() => daemonConnections.remove(connection.id)}>등록 삭제</button>
          </div>
          {connection.error && <p role="alert">{connection.error}</p>}
        </section>)}</div> : <p className="daemon-settings-empty">등록된 데몬이 없습니다.</p>}
        <div className="daemon-settings-add-heading"><span className="eyebrow">NEW CONNECTION</span><h2>데몬 추가</h2></div>
        <form className="daemon-settings-add-form" onSubmit={(event) => void addDaemon(event)}>
          <label htmlFor="settings-daemon-endpoint">데몬 WSS 주소</label>
          <input id="settings-daemon-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="wss://192.168.0.20:4753/rpc" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <label htmlFor="settings-daemon-fingerprint">인증서 SHA-256 지문</label>
          <input id="settings-daemon-fingerprint" value={fingerprint} onChange={(event) => setFingerprint(event.target.value)} placeholder="데몬이 출력한 64자리 지문" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <label htmlFor="settings-daemon-token">페어링 토큰</label>
          <input id="settings-daemon-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="데몬이 출력한 토큰" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          {error && <div className="connection-error" role="alert">{error}</div>}
          <button className="dialog-primary" type="submit" disabled={!endpoint.trim() || !token.trim() || !fingerprint.trim() || adding}>{adding ? "연결 중…" : "데몬 추가 및 연결"}</button>
        </form>
        <p className="daemon-settings-note">주소, SHA-256 지문, 토큰은 데몬 콘솔에 표시됩니다. 연결 전에 인증서 지문을 확인하세요.</p>
      </section>
    </section>
    {renameTarget && <div className="dialog-backdrop" onMouseDown={closeRenameOnBackdrop}>
      <form className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-settings-daemon-title" onSubmit={saveRename}>
        <div className="dialog-mark"><Icon name="edit" /></div>
        <h2 id="rename-settings-daemon-title">데몬 이름 수정</h2>
        <p>데몬 목록에 표시할 이름을 입력하세요.</p>
        <label htmlFor="rename-settings-daemon-name">데몬 이름</label>
        <input id="rename-settings-daemon-name" value={renameName} onChange={(event) => { setRenameName(event.target.value); setRenameError(""); }} autoFocus maxLength={100} />
        {renameError && <div className="connection-error" role="alert">{renameError}</div>}
        <div className="dialog-actions">
          <button type="button" className="dialog-secondary" onClick={closeRename}>취소</button>
          <button type="submit" className="dialog-primary" disabled={!renameName.trim()}>이름 저장</button>
        </div>
      </form>
    </div>}
  </>;
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
