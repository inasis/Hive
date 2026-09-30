import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { daemonConnections } from "./bridgeClient";
import { Icon } from "./shared/Icon";
import { WindowsWindowControls } from "./features/window/WindowsWindowControls";

/** Manage saved daemons without unmounting the conversation when a connection is added. */
export function DaemonPairingGate({ children, isWindowsDesktop, onUseDirectConnection }: {
  children: (changePairing: () => void, renameDaemon: (id: string) => void) => ReactNode;
  isWindowsDesktop: boolean;
  onUseDirectConnection?: () => void;
}) {
  const connections = useSyncExternalStore(daemonConnections.subscribe, daemonConnections.snapshot);
  const [managing, setManaging] = useState(connections.length === 0);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ id: string } | null>(null);
  const [daemonName, setDaemonName] = useState("");
  const [renameError, setRenameError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const renameDialog = useRef<HTMLFormElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const renameReturnFocus = useRef<HTMLElement | null>(null);
  const renameDialogOpen = useRef(false);
  useEffect(() => { daemonConnections.start(); }, []);
  useEffect(() => {
    if (!managing) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !renameDialogOpen.current && connections.length) setManaging(false);
      if (event.key !== "Tab") return;
      const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); returnFocus.current?.focus(); };
  }, [managing, connections.length]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setConnecting(true);
    try {
      await daemonConnections.add({ endpoint, token, fingerprint });
      setEndpoint(""); setToken(""); setFingerprint("");
      setManaging(false);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setConnecting(false); }
  };
  const retry = (id: string) => {
    setError("");
    void daemonConnections.connect(id).catch((reason: unknown) => setError(errorMessage(reason)));
  };
  const openRenameDaemon = (id: string) => {
    const connection = daemonConnections.snapshot().find((candidate) => candidate.id === id);
    if (!connection) return;
    renameReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    renameDialogOpen.current = true;
    setRenameTarget({ id });
    setDaemonName(connection.hostname);
    setRenameError("");
  };
  const closeRenameDaemon = () => {
    renameDialogOpen.current = false;
    setRenameTarget(null);
    setRenameError("");
  };
  const saveRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;
    try {
      daemonConnections.rename(renameTarget.id, daemonName);
      closeRenameDaemon();
    } catch (reason) { setRenameError(errorMessage(reason)); }
  };
  const closeRenameOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeRenameDaemon();
  };
  useEffect(() => {
    if (!renameTarget) return;
    renameDialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        renameDialogOpen.current = false;
        setRenameTarget(null);
        setRenameError("");
        return;
      }
      if (event.key !== "Tab") return;
      const elements = renameDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      renameReturnFocus.current?.focus();
      renameReturnFocus.current = null;
    };
  }, [renameTarget]);
  return <>
    <div inert={managing} aria-hidden={managing || undefined}>{children(() => setManaging(true), openRenameDaemon)}</div>
    {managing && <main className={`mobile-pairing-screen daemon-manager-screen ${isWindowsDesktop ? "windows-pairing-screen" : ""}`}>
      {isWindowsDesktop && <header className="windows-pairing-titlebar electrobun-webkit-app-region-drag"><span>Hive</span><div className="window-controls windows-window-controls electrobun-webkit-app-region-no-drag"><WindowsWindowControls onError={setError} /></div></header>}
      <div className="mobile-pairing-card daemon-manager-card" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="daemon-manager-title">
        <span className="eyebrow">HIVE DAEMONS</span>
        <div className="daemon-manager-title"><h1 id="daemon-manager-title">데몬 관리</h1><button type="button" className="dialog-secondary" onClick={() => setManaging(false)}>작업 공간으로</button></div>
        <p>여러 컴퓨터의 데몬을 연결하세요. 각 컴퓨터 아래에 작업 공간과 세션이 표시됩니다.</p>
        <div className="daemon-manager-list">{connections.map((connection) => <section className="daemon-manager-item" key={connection.id}>
          <div><b>{connection.hostname}</b><small>{connection.endpoint}</small><span>{connection.state === "connected" ? "연결됨" : connection.state === "connecting" ? "연결 중…" : "연결 안 됨"}</span></div>
          <div className="daemon-manager-actions">
            <button type="button" className="dialog-secondary daemon-manager-rename" onClick={() => openRenameDaemon(connection.id)}><Icon name="edit" />이름 변경</button>
            {connection.state === "disconnected" ? <button type="button" className="dialog-secondary" onClick={() => retry(connection.id)}>다시 연결</button> : <button type="button" className="dialog-secondary" onClick={() => daemonConnections.disconnect(connection.id)}>연결 종료</button>}
            <button type="button" className="dialog-secondary" onClick={() => daemonConnections.remove(connection.id)}>등록 삭제</button>
          </div>
          {connection.error && <p role="alert">{connection.error}</p>}
        </section>)}</div>
        <h2>데몬 추가</h2>
        <form onSubmit={(event) => void connect(event)}>
          <label htmlFor="mobile-daemon-endpoint">데몬 WSS 주소</label>
          <input id="mobile-daemon-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="wss://192.168.0.20:4753/rpc" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <label htmlFor="mobile-daemon-fingerprint">인증서 SHA-256 지문</label>
          <input id="mobile-daemon-fingerprint" value={fingerprint} onChange={(event) => setFingerprint(event.target.value)} placeholder="데몬이 출력한 64자리 지문" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <label htmlFor="mobile-daemon-token">페어링 토큰</label>
          <input id="mobile-daemon-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="데몬이 출력한 토큰" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          {error && <div className="mobile-pairing-error" role="alert">{error}</div>}
          <button className="dialog-primary" type="submit" disabled={!endpoint.trim() || !token.trim() || !fingerprint.trim() || connecting}>{connecting ? "연결 중…" : "데몬 추가 및 연결"}</button>
        </form>
        <div className="mobile-pairing-note">주소, SHA-256 지문, 토큰은 데몬 콘솔에 표시됩니다. 연결 전에 인증서 지문을 확인합니다.</div>
        {onUseDirectConnection && <button className="pairing-alternate" type="button" onClick={onUseDirectConnection}>SSH 또는 릴레이로 직접 연결</button>}
      </div>
    </main>}
    {renameTarget && <div className="dialog-backdrop daemon-rename-backdrop" onMouseDown={closeRenameOnBackdrop}>
      <form className="connect-dialog" ref={renameDialog} role="dialog" aria-modal="true" aria-labelledby="rename-daemon-dialog-title" onSubmit={saveRename}>
        <div className="dialog-mark"><Icon name="edit" /></div>
        <h2 id="rename-daemon-dialog-title">데몬 이름 수정</h2>
        <p>데몬 목록에 표시할 이름을 입력하세요.</p>
        <label htmlFor="rename-daemon-name">데몬 이름</label>
        <input id="rename-daemon-name" value={daemonName} onChange={(event) => { setDaemonName(event.target.value); setRenameError(""); }} autoFocus maxLength={100} />
        {renameError && <div className="connection-error" role="alert">{renameError}</div>}
        <div className="dialog-actions">
          <button type="button" className="dialog-secondary" onClick={closeRenameDaemon}>취소</button>
          <button type="submit" className="dialog-primary" disabled={!daemonName.trim()}>이름 저장</button>
        </div>
      </form>
    </div>}
  </>;
}
function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
