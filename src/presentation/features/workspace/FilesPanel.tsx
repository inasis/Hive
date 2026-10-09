import { useEffect, useRef, useState } from "react";
import type { WorkspaceFileOpenRequest } from "../../shared/workspace-state";
import type { WorkspaceFileListing, WorkspaceFileText } from "../../shared/bridge";
import { basename } from "../../shared/path-name";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";
export function FilesPanel({ target, cwd, openFileRequest, onOpenFileRequestHandled, onOpenFile }: {
  target: string;
  cwd: string;
  openFileRequest: WorkspaceFileOpenRequest | null;
  onOpenFileRequestHandled: (id: number) => void;
  onOpenFile: (target: string, cwd: string, file: WorkspaceFileText) => void;
}) {
  const { bridge } = useDesktopUiRuntime();
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
    void bridge.bridgeRpc.request.listWorkspaceFiles({ target, cwd, path })
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
  }, [bridge, target, cwd, path, refreshVersion]);

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
    void bridge.bridgeRpc.request.readWorkspaceFile({ target, cwd, path: request.path })
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
  }, [bridge, target, cwd, openFileRequest, onOpenFileRequestHandled, onOpenFile]);

  const openItem = async (item: WorkspaceFileListing["items"][number]) => {
    if (item.kind === "directory") {
      setPath(item.path);
      setSelected(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const file = await bridge.bridgeRpc.request.readWorkspaceFile({ target, cwd, path: item.path });
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
  if (!cwd) return <div className="workspace-panel-empty"><h2>작업 공간을 선택하세요</h2><p>세션을 열면 해당 경로의 파일을 둘러볼 수 있습니다.</p></div>;

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

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
