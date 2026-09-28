import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { addUiBridgeEventListener, bridgeRpc, removeUiBridgeEventListener } from "../../bridgeClient";
import type { UiBridgeEvent } from "../../shared/bridge-event-adapter";
import type { WorkspaceFileOpenRequest } from "./workspace-types";
import type { WorkspaceFileListing, WorkspaceFileText } from "../../../shared/bridge";

export function TerminalPanel({ target, cwd }: { target: string; cwd: string }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("연결 중");
  const [error, setError] = useState("");

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !target || !cwd) return;
    const sessionId = crypto.randomUUID().replaceAll("-", "_");
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Space Mono", "JetBrains Mono", "SF Mono", monospace',
      fontSize: 14,
      lineHeight: 1.35,
      scrollback: 8_000,
      theme: { background: "#080808", foreground: "#e8e8e8", cursor: "#ffffff", selectionBackground: "#494949" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    let stopped = false;
    let started = false;
    let resizeQueued = false;

    const onEvent = (event: UiBridgeEvent): void => {
      if (!("target" in event) || event.target !== target || event.threadId !== sessionId) return;
      if (event.type === "terminalData") {
        terminal.write(decodeBase64(event.data));
      } else if (event.type === "terminalReady") {
        setStatus("연결됨");
      } else if (event.type === "terminalError") {
        const message = event.message;
        setError(message);
        setStatus("오류");
        terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
      } else if (event.type === "terminalExit") {
        const exitCode = event.exitCode;
        setStatus("종료됨");
        terminal.writeln(`\r\n\x1b[90m터미널 프로세스 종료${exitCode === null ? "" : ` (코드 ${exitCode})`}\x1b[0m`);
      }
    };
    addUiBridgeEventListener(onEvent);
    const onInput = terminal.onData((data) => {
      if (started && !stopped) void bridgeRpc.request.terminalInput({ target, sessionId, data: encodeBase64(data) }).catch(showError);
    });
    const resizeObserver = new ResizeObserver(() => {
      if (resizeQueued || stopped) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        if (stopped) return;
        fit.fit();
        if (started) void bridgeRpc.request.terminalResize({ target, sessionId, cols: terminal.cols, rows: terminal.rows }).catch(showError);
      });
    });
    resizeObserver.observe(element);

    void bridgeRpc.request.terminalStart({ target, cwd, sessionId, cols: terminal.cols, rows: terminal.rows })
      .then(() => {
        if (stopped) {
          void bridgeRpc.request.terminalStop({ target, sessionId });
          return;
        }
        started = true;
        setStatus("연결됨");
        terminal.focus();
      })
      .catch(showError);

    function showError(reason: unknown): void {
      const message = errorMessage(reason);
      setError(message);
      setStatus("오류");
      terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
    }
    return () => {
      stopped = true;
      resizeObserver.disconnect();
      onInput.dispose();
      removeUiBridgeEventListener(onEvent);
      terminal.dispose();
      void bridgeRpc.request.terminalStop({ target, sessionId }).catch(() => undefined);
    };
  }, [target, cwd]);

  if (!cwd) return <div className="workspace-panel-empty"><h2>워크스페이스를 선택하세요</h2><p>세션을 열면 해당 경로에서 원격 터미널을 시작할 수 있습니다.</p></div>;
  return <section className="terminal-panel">
    <div className="panel-header"><div><b>원격 셸</b><span>{cwd}</span></div><span className={`panel-status ${status === "연결됨" ? "ready" : ""}`}><i />{status}</span></div>
    {error && <div className="panel-error">{error}</div>}
    <div className="terminal-screen" ref={elementRef} />
  </section>;
}

export function FilesPanel({ target, cwd, openFileRequest, onOpenFileRequestHandled, onOpenFile }: {
  target: string;
  cwd: string;
  openFileRequest: WorkspaceFileOpenRequest | null;
  onOpenFileRequestHandled: (id: number) => void;
  onOpenFile: (target: string, cwd: string, file: WorkspaceFileText) => void;
}) {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<WorkspaceFileListing | null>(null);
  const [selected, setSelected] = useState<WorkspaceFileText | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const currentRequest = useRef(0);

  useEffect(() => {
    setPath("");
    setListing(null);
    setSelected(null);
    setError("");
  }, [target, cwd]);

  useEffect(() => {
    if (!target || !cwd) return;
    const requestId = ++currentRequest.current;
    setLoading(true);
    setError("");
    void bridgeRpc.request.listWorkspaceFiles({ target, cwd, path })
      .then((result) => {
        if (currentRequest.current === requestId) setListing(result);
      })
      .catch((reason: unknown) => {
        if (currentRequest.current === requestId) setError(errorMessage(reason));
      })
      .finally(() => {
        if (currentRequest.current === requestId) setLoading(false);
      });
    return () => { currentRequest.current += 1; };
  }, [target, cwd, path, refreshVersion]);

  useEffect(() => {
    const request = openFileRequest;
    if (!request) return;
    if (request.target !== target || request.cwd !== cwd) {
      onOpenFileRequestHandled(request.id);
      return;
    }
    let cancelled = false;
    const parentPath = request.path.includes("/") ? request.path.slice(0, request.path.lastIndexOf("/")) : "";
    setPath(parentPath);
    setSelected(null);
    setError("");
    setLoading(true);
    void bridgeRpc.request.readWorkspaceFile({ target, cwd, path: request.path })
      .then((file) => {
        if (!cancelled) {
          setSelected(file);
          onOpenFile(target, cwd, file);
        }
      })
      .catch((reason: unknown) => { if (!cancelled) { setSelected(null); setError(errorMessage(reason)); } })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          onOpenFileRequestHandled(request.id);
        }
      });
    return () => { cancelled = true; };
  }, [target, cwd, openFileRequest, onOpenFileRequestHandled, onOpenFile]);

  const openItem = async (item: WorkspaceFileListing["items"][number]) => {
    if (item.kind === "directory") {
      setPath(item.path);
      setSelected(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const file = await bridgeRpc.request.readWorkspaceFile({ target, cwd, path: item.path });
      setSelected(file);
      onOpenFile(target, cwd, file);
    } catch (reason) {
      setSelected(null);
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  const segments = path ? path.split("/").filter(Boolean) : [];
  if (!cwd) return <div className="workspace-panel-empty"><h2>워크스페이스를 선택하세요</h2><p>세션을 열면 해당 경로의 파일을 둘러볼 수 있습니다.</p></div>;

  return <section className="files-panel">
    <div className="files-toolbar">
      <div className="file-breadcrumbs"><button onClick={() => { setPath(""); setSelected(null); }} title={cwd}>{basename(cwd)}</button>{segments.map((segment, index) => <span key={`${segment}-${index}`}><i>/</i><button onClick={() => { setPath(segments.slice(0, index + 1).join("/")); setSelected(null); }}>{segment}</button></span>)}</div>
      <button className="files-refresh" onClick={() => setRefreshVersion((value) => value + 1)} disabled={loading}>새로고침</button>
    </div>
    {error && <div className="panel-error">{error}</div>}
    <div className="files-body">
      <div className="file-list" aria-label="원격 파일 목록">
        {path && <button className="file-row parent-row" onClick={() => { setPath(segments.slice(0, -1).join("/")); setSelected(null); }}><span className="file-glyph directory">↰</span><span>상위 폴더</span></button>}
        {listing?.items.map((item) => <button className={`file-row ${selected?.path === item.path ? "selected" : ""}`} key={item.path} onClick={() => void openItem(item)} title={item.path}>
          <span className={`file-glyph ${item.kind}`}>{item.kind === "directory" ? "▰" : "·"}</span><span className="file-name">{item.name}</span><small>{item.kind === "directory" ? "폴더" : formatBytes(item.size)}</small>
        </button>)}
        {!loading && listing?.items.length === 0 && <div className="file-list-empty">이 폴더는 비어 있습니다.</div>}
        {loading && !listing && <div className="file-list-empty">불러오는 중…</div>}
      </div>
    </div>
    <div className="files-footnote">읽기 전용 · UTF-8 텍스트 · 최대 1 MiB</div>
  </section>;
}

export function FileDocument({ file }: { file: WorkspaceFileText }) {
  return <section className="file-preview file-document" aria-label={`파일 내용: ${file.path}`}>
    <div className="file-preview-heading"><b>{basename(file.path)}</b><span>{file.path} · {formatBytes(file.bytes)}</span></div>
    <pre>{file.content || "(빈 파일)"}</pre>
  </section>;
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
