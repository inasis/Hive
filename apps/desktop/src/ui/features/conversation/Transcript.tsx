import { Fragment, memo, useState, type MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { TranscriptEntry } from "../../../shared/bridge";
import { Icon } from "../../shared/Icon";
import { MermaidMarkdownPre } from "../../shared/MermaidMarkdown";

export const Transcript = memo(function Transcript({ entry, cwd, onOpenFile, copyText, responseDurationMs, onFork, forking = false }: { entry: TranscriptEntry; cwd?: string; onOpenFile?: (path: string) => void; copyText?: string; responseDurationMs?: number; onFork?: () => void; forking?: boolean }) {
  if (entry.role === "user") return <div className="user-entry"><div className="user-bubble markdown-body"><MessageMarkdown text={entry.text} cwd={cwd ?? ""} onOpenFile={onOpenFile} />{entry.images?.length ? <div className="transcript-images">{entry.images.map((image) => <img key={`${image.name}:${image.data.length}`} src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} title={image.name} loading="lazy" />)}</div> : null}</div><CopyTranscriptButton text={entry.text} /></div>;
  if (entry.role === "tool") {
    const isWebSearch = entry.toolType === "webSearch";
    const label = isWebSearch ? "웹 검색" : "명령";
    return <details className="tool-card"><summary className="tool-card-heading"><span className="tool-icon"><Icon name={isWebSearch ? "search" : "terminal"} /></span><b>{entry.status === "inProgress" ? (isWebSearch ? "검색 중" : "실행 중") : label}</b><code>{entry.command || entry.text}</code><span className={`tool-state ${entry.status === "failed" ? "failed" : ""}`}>{entry.status === "inProgress" ? (isWebSearch ? "검색 중" : "실행 중") : entry.status ?? "완료"}</span><Icon name="chevron-down" /></summary><div className="tool-card-details">{entry.command && <pre className="tool-command">{entry.command}</pre>}{entry.output && <pre>{entry.output}</pre>}</div></details>;
  }
  if (entry.role === "change") return <div className="change-summary"><span className="change-icon"><Icon name="files" /></span><b>{entry.status === "inProgress" ? "파일 변경 중" : "파일 변경"}</b><span className="change-detail">{entry.text}</span></div>;
  if (entry.role === "communication") {
    const communications = entry.communications ?? [];
    const requests = communications.filter((communication) => communication.kind === "request");
    const results = communications.filter((communication) => communication.kind === "result");
    const executionCount = new Set(requests.map((communication) => communication.taskId)).size;
    return <Fragment>
      {requests.length > 0 && <details className="activity-group"><summary className="activity-group-summary" onClick={scrollByActivityExpansion}>
        <span className="activity-group-mark"><Icon name="chevrons" /></span>
        <b>통신 요약</b>
        <span className="activity-group-count">{executionCount}개 통신 실행</span>
        <Icon name="chevron-down" />
      </summary>
        <div className="activity-group-body a2a-communication-list">
          {requests.map((communication, index) => <article className="a2a-communication-message" key={`${communication.taskId}:${communication.sourceAgentId}:${index}`}>
            <header><b>{communication.sourceSessionName || "Hive 에이전트"}</b><span>요청</span></header>
            <div className="markdown-body"><MessageMarkdown text={communication.message} cwd={cwd ?? ""} onOpenFile={onOpenFile} /></div>
          </article>)}
        </div>
      </details>}
      {results.map((communication, index) => <div className="assistant-entry a2a-response-entry" key={`${communication.taskId}:${communication.sourceAgentId}:${index}`}>
        <div className="a2a-response-byline">{communication.sourceSessionName || "Hive 에이전트"}</div>
        <div className="assistant-body"><div className="transcript-text markdown-body"><MessageMarkdown text={communication.message} cwd={cwd ?? ""} onOpenFile={onOpenFile} /></div></div>
      </div>)}
    </Fragment>;
  }
  return <div className="assistant-entry"><div className="assistant-body"><div className="transcript-text markdown-body"><MessageMarkdown text={entry.text} cwd={cwd ?? ""} onOpenFile={onOpenFile} /></div></div>{copyText !== undefined && <div className="assistant-entry-actions"><CopyTranscriptButton text={copyText} />{onFork && <button className="message-copy-button message-fork-button" type="button" disabled={forking} onClick={onFork} aria-label="이 AI 응답까지 영구 포크 세션 만들기" title="이 응답까지 영구 세션으로 포크"><Icon name={forking ? "refresh" : "branch"} /><span>{forking ? "포크 중…" : "포크"}</span></button>}{responseDurationMs !== undefined && <span className="response-duration">{formatResponseDuration(responseDurationMs)}</span>}</div>}</div>;
});

function formatResponseDuration(durationMs: number): string {
  let seconds = Math.max(1, Math.floor(durationMs / 1_000));
  const units = [[86_400, "일"], [3_600, "시간"], [60, "분"], [1, "초"]] as const;
  const parts: string[] = [];
  for (const [unitSeconds, label] of units) {
    const count = Math.floor(seconds / unitSeconds);
    if (count > 0) parts.push(`${count}${label}`);
    seconds %= unitSeconds;
  }
  return `${parts.join(" ")} 동안 동작함`;
}

const CopyTranscriptButton = memo(function CopyTranscriptButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setState("copied");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      setState(copied ? "copied" : "failed");
    }
    window.setTimeout(() => setState("idle"), 1400);
  };
  return <button type="button" className="message-copy-button" onClick={() => void copy()} aria-label={state === "copied" ? "메시지를 복사했습니다" : "메시지 전체 복사"} title="메시지 전체 복사"><Icon name={state === "copied" ? "check" : "copy"} /><span>{state === "copied" ? "복사됨" : state === "failed" ? "복사 실패" : "복사"}</span></button>;
});

function MessageMarkdown({ text, cwd, onOpenFile }: { text: string; cwd: string; onOpenFile?: (path: string) => void }) {
  const components: Components = {
    a: ({ href, title, children }) => {
      const filePath = href ? resolveMarkdownWorkspacePath(href, cwd) : null;
      if (filePath && onOpenFile) {
        return <a href={href} title={`파일 열기: ${filePath}`} onClick={(event) => { event.preventDefault(); onOpenFile(filePath); }}>{children}</a>;
      }
      const opensNewTab = Boolean(href && /^https?:/i.test(href));
      return <a href={href} title={title} target={opensNewTab ? "_blank" : undefined} rel={opensNewTab ? "noopener noreferrer" : undefined}>{children}</a>;
    },
    pre: MermaidMarkdownPre,
    table: ({ children }) => <div className="markdown-table-wrap"><table>{children}</table></div>,
  };
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>{text}</ReactMarkdown>;
}

function resolveMarkdownWorkspacePath(href: string, cwd: string): string | null {
  if (!href || !cwd || href.startsWith("#")) return null;
  let destination = href;
  if (/^file:/i.test(destination)) {
    try {
      const url = new URL(destination);
      if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) return null;
      destination = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(destination)) destination = destination.slice(1);
    } catch {
      return null;
    }
  } else {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(destination) && !/^[A-Za-z]:[\\/]/.test(destination)) return null;
    destination = destination.split(/[?#]/, 1)[0] ?? "";
    try { destination = decodeURIComponent(destination); } catch { /* Keep valid literal path characters. */ }
  }
  destination = destination.replace(/:\d+(?::\d+)?$/, "").replaceAll("\\", "/");
  const normalizedRoot = normalizeMarkdownPath(cwd.replaceAll("\\", "/"));
  if (!normalizedRoot || (!normalizedRoot.startsWith("/") && !/^[A-Za-z]:\//.test(normalizedRoot))) return null;
  const isAbsolute = destination.startsWith("/") || /^[A-Za-z]:\//.test(destination);
  if (isAbsolute) {
    const absolutePath = normalizeMarkdownPath(destination);
    if (!absolutePath) return null;
    const windowsPath = /^[A-Za-z]:\//.test(normalizedRoot);
    const root = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot;
    const candidate = windowsPath ? absolutePath.toLowerCase() : absolutePath;
    if (candidate === root) return null;
    const prefix = root.endsWith("/") ? root : `${root}/`;
    return candidate.startsWith(prefix) ? absolutePath.slice(prefix.length) : null;
  }
  return normalizeMarkdownPath(destination);
}

function normalizeMarkdownPath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const drive = normalized.match(/^([A-Za-z]:)\//)?.[1] ?? "";
  const absolute = normalized.startsWith("/");
  const rest = drive ? normalized.slice(3) : absolute ? normalized.slice(1) : normalized;
  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) {
        if (!absolute && !drive) return null;
        continue;
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const prefix = drive ? `${drive}/` : absolute ? "/" : "";
  return `${prefix}${segments.join("/")}` || (prefix || null);
}

export const ActivityGroup = memo(function ActivityGroup({ entries }: { entries: TranscriptEntry[] }) {
  const commands = entries.filter((entry) => entry.role === "tool" && entry.toolType !== "webSearch");
  const webSearches = entries.filter((entry) => entry.role === "tool" && entry.toolType === "webSearch");
  const changedFiles = new Map<string, TranscriptEntry>();
  for (const entry of entries) {
    if (entry.role !== "change") continue;
    const paths = entry.text.split("\n").map((path) => path.trim()).filter(Boolean);
    for (const path of paths.length ? paths : ["변경된 파일"]) changedFiles.set(path, entry);
  }
  const filesInProgress = entries.some((entry) => entry.role === "change" && entry.status === "inProgress");
  const commandsInProgress = commands.some((entry) => entry.status === "inProgress");
  const webSearchesInProgress = webSearches.some((entry) => entry.status === "inProgress");

  return <details className="activity-group"><summary className="activity-group-summary" onClick={scrollByActivityExpansion}>
    <span className="activity-group-mark"><Icon name="chevrons" /></span>
    <b>작업 요약</b>
    {changedFiles.size > 0 && <span className="activity-group-count">{changedFiles.size}개 파일 {filesInProgress ? "수정 중" : "수정"}</span>}
    {commands.length > 0 && <span className="activity-group-count">{commands.length}개 명령 {commandsInProgress ? "실행 중" : "실행"}</span>}
    {webSearches.length > 0 && <span className="activity-group-count">{webSearches.length}개 웹 검색{webSearchesInProgress ? " 중" : ""}</span>}
    <Icon name="chevron-down" />
  </summary>
    <div className="activity-group-body">
      {changedFiles.size > 0 && <details className="activity-category"><summary><Icon name="files" />수정한 파일 <span>({changedFiles.size})</span><Icon name="chevron-down" /></summary>
        <div className="activity-list">{[...changedFiles].map(([path, entry]) => <div className="activity-file-row" key={path}><Icon name="files" /><code>{path}</code><span>{entry.status === "inProgress" ? "수정 중" : "수정됨"}</span></div>)}</div>
      </details>}
      {commands.length > 0 && <details className="activity-category"><summary><Icon name="terminal" />실행한 명령 <span>({commands.length})</span><Icon name="chevron-down" /></summary>
        <div className="activity-list">{commands.map((entry) => <Transcript key={entry.id} entry={entry} />)}</div>
      </details>}
      {webSearches.length > 0 && <details className="activity-category"><summary><Icon name="search" />웹 검색 <span>({webSearches.length})</span><Icon name="chevron-down" /></summary>
        <div className="activity-list">{webSearches.map((entry) => <Transcript key={entry.id} entry={entry} />)}</div>
      </details>}
    </div>
  </details>;
});

function scrollByActivityExpansion(event: ReactMouseEvent<HTMLElement>) {
  const details = event.currentTarget.parentElement;
  if (!(details instanceof HTMLDetailsElement) || details.open) return;
  const collapsedHeight = details.getBoundingClientRect().height;
  const scroll = details.closest<HTMLDivElement>(".conversation-scroll");
  requestAnimationFrame(() => {
    if (!details.open || !scroll) return;
    const expandedHeight = details.getBoundingClientRect().height - collapsedHeight;
    if (expandedHeight > 0) scroll.scrollBy({ top: expandedHeight, behavior: "smooth" });
  });
}
