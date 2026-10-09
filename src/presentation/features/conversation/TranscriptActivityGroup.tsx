import { memo } from "react";
import type { TranscriptEntry } from "../../shared/bridge";
import { Icon } from "../../shared/Icon";
import { Transcript } from "./Transcript";
import { scrollByActivityExpansion } from "./scroll-by-activity-expansion";

export const TranscriptActivityGroup = memo(function TranscriptActivityGroup({ entries }: { entries: TranscriptEntry[] }) {
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
