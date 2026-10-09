import { Fragment, memo } from "react";
import type { TranscriptEntry } from "../../shared/bridge";
import { Icon } from "../../shared/Icon";
import { TranscriptCopyButton } from "./TranscriptCopyButton";
import { TranscriptMarkdown } from "./TranscriptMarkdown";
import { scrollByActivityExpansion } from "./scroll-by-activity-expansion";
import { removeLegacyPersonaPromptContext } from "../../shared/persona-prompt-context";

export const Transcript = memo(function Transcript({ entry, cwd, onOpenFile, copyText, responseDurationMs, onFork, forking = false }: { entry: TranscriptEntry; cwd?: string; onOpenFile?: (path: string) => void; copyText?: string; responseDurationMs?: number; onFork?: () => void; forking?: boolean }) {
  if (entry.role === "user") {
    const visibleText = removeLegacyPersonaPromptContext(entry.text);
    return <div className="user-entry"><div className="user-bubble markdown-body"><TranscriptMarkdown text={visibleText} cwd={cwd ?? ""} onOpenFile={onOpenFile} />{entry.images?.length ? <div className="transcript-images">{entry.images.map((image) => <img key={`${image.name}:${image.data.length}`} src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} title={image.name} loading="lazy" />)}</div> : null}</div><TranscriptCopyButton text={visibleText} /></div>;
  }
  if (entry.role === "tool") {
    const isWebSearch = entry.toolType === "webSearch";
    const isFailed = entry.status?.toLowerCase() === "failed";
    const label = isWebSearch ? "웹 검색" : "명령";
    const statusLabel = entry.status === "inProgress"
      ? isWebSearch ? "검색 중" : "실행 중"
      : toolStatusLabel(entry.status);
    return <details className="tool-card"><summary className="tool-card-heading"><span className="tool-icon"><Icon name={isWebSearch ? "search" : "terminal"} /></span><b>{entry.status === "inProgress" ? (isWebSearch ? "검색 중" : "실행 중") : label}</b><code>{entry.command || entry.text}</code><span className={`tool-state ${isFailed ? "failed" : ""}`}>{statusLabel}</span><Icon name="chevron-down" /></summary><div className="tool-card-details">{entry.command && <pre className="tool-command">{entry.command}</pre>}{entry.output && <pre>{entry.output}</pre>}</div></details>;
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
            <div className="markdown-body"><TranscriptMarkdown text={communication.message} cwd={cwd ?? ""} onOpenFile={onOpenFile} /></div>
          </article>)}
        </div>
      </details>}
      {results.map((communication, index) => <div className="assistant-entry a2a-response-entry" key={`${communication.taskId}:${communication.sourceAgentId}:${index}`}>
        <div className="a2a-response-byline">{communication.sourceSessionName || "Hive 에이전트"}</div>
        <div className="assistant-body"><div className="transcript-text markdown-body"><TranscriptMarkdown text={communication.message} cwd={cwd ?? ""} onOpenFile={onOpenFile} /></div></div>
      </div>)}
    </Fragment>;
  }
  return <div className="assistant-entry"><div className="assistant-body"><div className="transcript-text markdown-body"><TranscriptMarkdown text={entry.text} cwd={cwd ?? ""} onOpenFile={onOpenFile} /></div></div>{copyText !== undefined && <div className="assistant-entry-actions"><TranscriptCopyButton text={copyText} />{onFork && <button className="message-copy-button message-fork-button" type="button" disabled={forking} onClick={onFork} aria-label="이 AI 응답까지 영구 포크 세션 만들기" title="이 응답까지 영구 세션으로 포크"><Icon name={forking ? "refresh" : "branch"} /><span>{forking ? "포크 중…" : "포크"}</span></button>}{responseDurationMs !== undefined && <span className="response-duration">{formatResponseDuration(responseDurationMs)}</span>}</div>}</div>;
});

function toolStatusLabel(status: string | undefined): string {
  if (!status) return "완료";
  switch (status.toLowerCase()) {
    case "failed": return "실패";
    case "completed": return "완료";
    default: return status;
  }
}

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
