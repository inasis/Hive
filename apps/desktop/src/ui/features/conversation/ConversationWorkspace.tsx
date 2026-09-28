import { useEffect, useRef, type ComponentProps, type Dispatch, type RefObject, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { FileDocument, TerminalPanel } from "../workspace/WorkspacePanels";
import { Icon } from "../../shared/Icon";
import { basename } from "../workspace/session-groups";
import type { WorkspaceFileTab, WorkspaceTab } from "../workspace/workspace-types";
import { Composer } from "./Composer";
import { ActivityGroup, Transcript } from "./Transcript";
import { assistantResponseTextForEntry, canForkTranscriptEntry, groupTranscriptEntries } from "./transcript-state";
import type { SideChatTab } from "./session-state";
import type { AssistantProvider, TranscriptEntry } from "../../../shared/bridge";

type Props = {
  thread: {
    id: string;
    provider: AssistantProvider;
    providerName: string;
    target: string;
    targetLabel: string;
    cwd: string;
    entries: TranscriptEntry[];
    opening: boolean;
    unfinishedResponse: boolean;
    busy: boolean;
    busyElapsed: number;
    forkingEntryId: string;
  };
  tabs: {
    active: WorkspaceTab;
    activeSideChatId: string;
    rootThreadId: string;
    mainThreadLabel: string;
    sideChats: SideChatTab[];
    terminal: { target: string; cwd: string } | null;
    files: WorkspaceFileTab[];
    activeFile: WorkspaceFileTab | null;
    createMenuOpen: boolean;
    createMenuPosition: { top: number; left: number } | null;
    createMenuRef: RefObject<HTMLDivElement | null>;
    createButtonRef: RefObject<HTMLButtonElement | null>;
    creatingSideChat: boolean;
    creatingSession: boolean;
  };
  composer: ComponentProps<typeof Composer>;
  emptyState: {
    connectionState: "disconnected" | "connecting" | "connected";
    providerName: string;
    creatingSession: boolean;
    notice: string;
  };
  actions: {
    setActiveTab: Dispatch<SetStateAction<WorkspaceTab>>;
    switchChatTab: (threadId: string, sideChatId?: string) => void;
    closeSideChat: (chat: SideChatTab) => void;
    closeTerminalTab: () => void;
    closeFileTab: (id: string) => void;
    toggleCreateMenu: (button: HTMLButtonElement) => void;
    closeCreateMenu: () => void;
    createSideChat: () => void;
    openTerminalTab: () => void;
    openFile: (path: string) => void;
    forkResponse: (entry: TranscriptEntry) => void;
    openNewWorkspace: () => void;
    openConnectionSettings: () => void;
  };
};

export function ConversationWorkspace({ thread, tabs, composer, emptyState, actions }: Props) {
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroll = conversationRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [thread.entries, thread.busy]);

  return <>
    <div className="content-row">
      <section className="conversation-pane">
        <div className="side-chat-tabs" role="tablist" aria-label="작업 탭">
          <button role="tab" aria-selected={tabs.active === "chat" && !tabs.activeSideChatId} className={tabs.active === "chat" && !tabs.activeSideChatId ? "active" : ""} onClick={() => thread.id ? actions.switchChatTab(tabs.rootThreadId) : actions.setActiveTab("chat")} title="메인 대화">
            <Icon name="message" /><span>{thread.id ? tabs.mainThreadLabel : "대화"}</span>
          </button>
          {tabs.sideChats.map((chat) => {
            const isActive = tabs.active === "chat" && thread.provider === chat.provider && thread.id === chat.threadId;
            return <div className={`workspace-file-tab conversation-tab ${isActive ? "active" : ""}`} key={`${chat.provider}:${chat.threadId}`} role="presentation">
              <button className="workspace-file-tab-select" role="tab" aria-selected={isActive} onClick={() => actions.switchChatTab(chat.threadId, chat.threadId)} title={chat.persistent ? "프로바이더에 저장된 영구 포크 대화" : "앱 연결이 끝나면 사라지는 임시 대화"}><Icon name="branch" /><span>{chat.label}</span></button>
              <button className="workspace-file-tab-close" type="button" aria-label={`${chat.label} 탭 닫기`} title="탭 닫기" onClick={() => actions.closeSideChat(chat)}><Icon name="close" /></button>
            </div>;
          })}
          {tabs.terminal && <div className={`workspace-file-tab conversation-tab ${tabs.active === "terminal" ? "active" : ""}`} role="presentation">
            <button className="workspace-file-tab-select" role="tab" aria-selected={tabs.active === "terminal"} onClick={() => actions.setActiveTab("terminal")} title={tabs.terminal.cwd}><Icon name="terminal" /><span>터미널</span></button>
            <button className="workspace-file-tab-close" type="button" aria-label="터미널 탭 닫기" title="탭 닫기" onClick={actions.closeTerminalTab}><Icon name="close" /></button>
          </div>}
          {tabs.files.map((tab) => {
            const tabId: WorkspaceTab = `file:${tab.id}`;
            const isActive = tabs.active === tabId;
            const fileName = basename(tab.file.path);
            return <div className={`workspace-file-tab conversation-tab ${isActive ? "active" : ""}`} key={tab.id} role="presentation">
              <button className="workspace-file-tab-select" role="tab" aria-selected={isActive} title={tab.file.path} onClick={() => actions.setActiveTab(tabId)}><Icon name="files" /><span>{fileName}</span></button>
              <button className="workspace-file-tab-close" type="button" aria-label={`${fileName} 탭 닫기`} title="탭 닫기" onClick={() => actions.closeFileTab(tab.id)}><Icon name="close" /></button>
            </div>;
          })}
          <button ref={tabs.createButtonRef} className="side-chat-add" type="button" aria-label="탭 추가" aria-expanded={tabs.createMenuOpen} title="탭 추가" onClick={(event) => actions.toggleCreateMenu(event.currentTarget)}><Icon name="plus" /></button>
        </div>
        {tabs.active === "chat" && thread.id && <>
          <div className="conversation-scroll" ref={conversationRef}><div className="conversation-inner">
            <div className="conversation-date"><span />{thread.targetLabel} · {thread.id.slice(0, 8)}<span /></div>
            {thread.opening && <div className="inline-state">원격 대화 기록을 가져오는 중…</div>}
            {!thread.opening && !thread.entries.length && <div className="empty-conversation"><div className="empty-icon"><Icon name="message" /></div><h2>대화 기록이 없습니다</h2><p>메시지를 보내면 {thread.providerName}가 이 세션을 이어갑니다.</p></div>}
            {groupTranscriptEntries(thread.entries).map((block) => {
              if (block.kind === "activity") return <ActivityGroup key={block.id} entries={block.entries} />;
              const copyText = assistantResponseTextForEntry(block.entry, thread.entries, !thread.unfinishedResponse);
              const canFork = canForkTranscriptEntry(block.entry, copyText !== undefined);
              return <Transcript
                key={block.entry.id}
                entry={block.entry}
                cwd={thread.cwd}
                onOpenFile={actions.openFile}
                copyText={copyText}
                onFork={canFork ? () => actions.forkResponse(block.entry) : undefined}
                forking={thread.forkingEntryId === block.entry.id}
              />;
            })}
            {thread.busy && <div className="working-indicator"><span /><span /><span /> {thread.providerName}가 응답 중입니다 · {formatElapsed(thread.busyElapsed)}</div>}
          </div></div>
          <Composer {...composer} />
        </>}
        {tabs.active === "chat" && !thread.id && (
          <div className="empty-state">
            <div className="empty-icon"><Icon name="message" /></div>
            <h2>{emptyState.connectionState === "connected" ? `${emptyState.providerName} 세션을 선택하세요` : `${emptyState.providerName}에 연결하세요`}</h2>
            <p>{emptyState.connectionState === "connected" ? "왼쪽에서 기존 세션을 선택하거나 현재 워크스페이스에서 새 세션을 만드세요." : `${emptyState.providerName}에 연결하면 세션과 대화를 불러올 수 있습니다.`}</p>
            {emptyState.connectionState === "connected" ? <button className="dialog-primary" onClick={actions.openNewWorkspace} disabled={emptyState.creatingSession}>새 워크스페이스</button> : <button onClick={actions.openConnectionSettings}>SSH 호스트 연결</button>}
            {emptyState.notice && <div className="inline-notice" role="status"><Icon name="info" />{emptyState.notice}</div>}
          </div>
        )}
        {tabs.terminal && <div className="workspace-tab-panel" hidden={tabs.active !== "terminal"}><TerminalPanel target={tabs.terminal.target} cwd={tabs.terminal.cwd} /></div>}
        {tabs.activeFile && tabs.active === `file:${tabs.activeFile.id}` && <FileDocument file={tabs.activeFile.file} />}
      </section>
    </div>
    {tabs.createMenuOpen && tabs.createMenuPosition && createPortal(<div ref={tabs.createMenuRef} className="tab-create-menu" style={tabs.createMenuPosition} role="menu">
      <button type="button" role="menuitem" disabled={!thread.id || tabs.creatingSideChat || thread.opening} onClick={() => { actions.closeCreateMenu(); actions.createSideChat(); }}><Icon name="message" /><span>{tabs.creatingSideChat ? "여는 중…" : "새 대화"}</span></button>
      {!tabs.terminal && <button type="button" role="menuitem" disabled={!thread.target || !thread.cwd} onClick={actions.openTerminalTab}><Icon name="terminal" /><span>터미널</span></button>}
    </div>, document.body)}
  </>;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}
