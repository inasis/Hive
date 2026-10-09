import { Fragment, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shared/Icon";
import { basename } from "../../shared/path-name";
import type { WorkspaceFileTab, WorkspaceTab } from "../../shared/workspace-state";
import { Composer } from "./Composer";
import { TranscriptActivityGroup } from "./TranscriptActivityGroup";
import { Transcript } from "./Transcript";
import { SessionGoalBanner } from "./SessionGoalBanner";
import { assistantResponseTextForEntry, canForkTranscriptEntry, groupTranscriptEntries } from "./transcript-state";
import type { SideChatTab } from "../../shared/conversation-view";
import type { AssistantProvider, TranscriptEntry } from "../../shared/bridge";
import { groupTranscriptResponses } from "../../../domain/transcript.js";
import { useTranscriptHistoryWindow } from "./useTranscriptHistoryWindow";
import { useTranscriptViewport } from "./useTranscriptViewport";

const FileDocument = lazy(() => import("../../shared/FileDocument").then(({ FileDocument: component }) => ({ default: component })));

type Props = {
  thread: {
    id: string;
    title: string;
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
    creatingSession: boolean;
  };
  composer: ComponentProps<typeof Composer>;
  emptyState: {
    connectionState: "disconnected" | "connecting" | "connected";
    providerName: string;
    creatingSession: boolean;
    notice: string;
  };
  terminalPanel: ReactNode;
  actions: {
    setActiveTab: Dispatch<SetStateAction<WorkspaceTab>>;
    switchChatTab: (threadId: string, sideChatId?: string) => void;
    closeSideChat: (chat: SideChatTab) => void;
    closeTerminalTab: () => void;
    closeFileTab: (id: string) => void;
    toggleCreateMenu: (button: HTMLButtonElement) => void;
    closeCreateMenu: () => void;
    openNewSession: () => void;
    renameSession: (provider: AssistantProvider, threadId: string, title: string) => void;
    openTerminalTab: () => void;
    openFile: (path: string) => void;
    forkResponse: (entry: TranscriptEntry) => void;
    openNewWorkspace: () => void;
    openConnectionSettings: () => void;
  };
};

type WorkspaceHeaderTab = {
  id: string;
  title: string;
  icon: "message" | "branch" | "terminal" | "files";
  kind: "chat" | "terminal" | "file";
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
  onRename?: () => void;
};

export function ConversationWorkspace({ thread, tabs, composer, emptyState, terminalPanel, actions }: Props) {
  const conversationRef = useRef<HTMLDivElement>(null);
  const threadKey = `${thread.target}\u0000${thread.provider}\u0000${thread.id}`;
  const transcriptGroups = useMemo(() => groupTranscriptResponses(thread.entries), [thread.entries]);
  const chatActive = tabs.active === "chat";
  const viewport = useTranscriptViewport({ threadKey, chatActive, responseGroups: transcriptGroups, scrollRef: conversationRef });
  const history = useTranscriptHistoryWindow({
    threadKey,
    target: thread.target,
    provider: thread.provider,
    threadId: thread.id,
    chatActive,
    responseGroups: transcriptGroups,
    scrollRef: conversationRef,
    followingLatestRef: viewport.followingLatestRef,
  });
  const onScroll = useCallback(() => {
    history.onHistoryScroll();
    viewport.onViewportScroll();
  }, [history.onHistoryScroll, viewport.onViewportScroll]);
  const { visibleGroups, hasOlder, historySentinelRef } = history;
  const { showJumpToLatest, jumpToLatest } = viewport;
  const responseGroups = useMemo(() => visibleGroups.map((group) => ({
    ...group,
    blocks: groupTranscriptEntries(group.entries),
  })), [visibleGroups]);
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [tabSearch, setTabSearch] = useState("");
  const [tabSwitcherNeeded, setTabSwitcherNeeded] = useState(false);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);

  const tabItems: WorkspaceHeaderTab[] = [
    {
      id: `chat:${thread.provider}:${tabs.rootThreadId}`,
      title: tabs.mainThreadLabel,
      icon: "message",
      kind: "chat",
      active: tabs.active === "chat" && !tabs.activeSideChatId,
      onSelect: () => thread.id ? actions.switchChatTab(tabs.rootThreadId) : actions.setActiveTab("chat"),
      ...(thread.id ? { onRename: () => actions.renameSession(thread.provider, tabs.rootThreadId, tabs.mainThreadLabel) } : {}),
    },
    ...tabs.sideChats.map((chat): WorkspaceHeaderTab => {
      const active = tabs.active === "chat" && thread.provider === chat.provider && thread.id === chat.threadId;
      const title = active && thread.title ? thread.title : chat.label;
      return {
        id: `chat:${chat.provider}:${chat.threadId}`,
        title,
        icon: chat.kind === "session" ? "message" : "branch",
        kind: "chat",
        active,
        onSelect: () => actions.switchChatTab(chat.threadId, chat.threadId),
        onClose: () => actions.closeSideChat(chat),
        ...(chat.persistent ? { onRename: () => actions.renameSession(chat.provider, chat.threadId, title) } : {}),
      };
    }),
    ...(tabs.terminal ? [{
      id: "terminal",
      title: "터미널",
      icon: "terminal" as const,
      kind: "terminal" as const,
      active: tabs.active === "terminal",
      onSelect: () => actions.setActiveTab("terminal"),
      onClose: actions.closeTerminalTab,
    }] : []),
    ...tabs.files.map((tab): WorkspaceHeaderTab => ({
      id: `file:${tab.id}`,
      title: basename(tab.file.path),
      icon: "files",
      kind: "file",
      active: tabs.active === `file:${tab.id}`,
      onSelect: () => actions.setActiveTab(`file:${tab.id}`),
      onClose: () => actions.closeFileTab(tab.id),
    })),
  ];
  const activeTabItem = tabItems.find((item) => item.active) ?? tabItems[0]!;
  const tabMeasureKey = tabItems.map((item) => `${item.id}\u0000${item.title}\u0000${item.active}`).join("\u0001");

  useLayoutEffect(() => {
    const updateOverflow = () => {
      const bar = tabBarRef.current;
      const list = tabListRef.current;
      if (!bar || !list) return;
      const needsSwitcher = tabItems.length >= 2 && list.scrollWidth > bar.clientWidth * 0.9;
      setTabSwitcherNeeded((current) => current === needsSwitcher ? current : needsSwitcher);
    };
    updateOverflow();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateOverflow);
      return () => window.removeEventListener("resize", updateOverflow);
    }
    const observer = new ResizeObserver(updateOverflow);
    if (tabBarRef.current) observer.observe(tabBarRef.current);
    if (tabListRef.current) observer.observe(tabListRef.current);
    return () => observer.disconnect();
  }, [tabMeasureKey]);

  useEffect(() => {
    if (!tabSwitcherOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabSwitcherOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [tabSwitcherOpen]);

  const normalizedTabSearch = tabSearch.trim().toLocaleLowerCase();
  const filteredTabItems = normalizedTabSearch
    ? tabItems.filter((item) => item.title.toLocaleLowerCase().includes(normalizedTabSearch))
    : tabItems;

  const renderTab = (item: WorkspaceHeaderTab) => {
    const selectButton = <button className="workspace-file-tab-select" role="tab" aria-selected={item.active} onClick={item.onSelect} title={item.title}>
      <Icon name={item.icon} /><span>{item.title}</span>
    </button>;
    if (item.onClose) return <div className={`workspace-file-tab conversation-tab ${item.active ? "active" : ""}`} key={item.id} role="presentation">
      {selectButton}
      <button className="workspace-file-tab-close" type="button" aria-label={`${item.title} 탭 닫기`} title="탭 닫기" onClick={item.onClose}><Icon name="close" /></button>
    </div>;
    return <button role="tab" aria-selected={item.active} className={`conversation-workspace-tab ${item.active ? "active" : ""}`} key={item.id} onClick={item.onSelect} title={item.title}>
      <Icon name={item.icon} /><span>{item.title}</span>
    </button>;
  };

  return <>
    <div className="content-row">
      <section className="conversation-pane">
        <div ref={tabBarRef} className={`side-chat-tabs ${tabSwitcherNeeded ? "uses-tab-switcher" : ""}`}>
          <div ref={tabListRef} className="side-chat-tab-list" role="tablist" aria-label="작업 탭" aria-hidden={tabSwitcherNeeded}>
            {tabItems.map(renderTab)}
          </div>
          {tabSwitcherNeeded ? <div className="side-chat-tab-switcher" role="tablist" aria-label="작업 탭">
            <button className="side-chat-current-tab" type="button" role="tab" aria-selected="true" title={activeTabItem.title} onClick={activeTabItem.onSelect}>
              <Icon name={activeTabItem.icon} /><span>{activeTabItem.title}</span>
            </button>
            <button className="side-chat-open-tabs" type="button" aria-haspopup="dialog" aria-expanded={tabSwitcherOpen} onClick={() => { setTabSearch(""); setTabSwitcherOpen(true); }}>
              <span>열린 탭 {tabItems.length}</span><Icon name="chevron-down" />
            </button>
            <button ref={tabs.createButtonRef} className="side-chat-add" type="button" aria-label="새 탭 추가" aria-expanded={tabs.createMenuOpen} title="새 탭" onClick={(event) => actions.toggleCreateMenu(event.currentTarget)}><Icon name="plus" /></button>
          </div> : <button ref={tabs.createButtonRef} className="side-chat-add" type="button" aria-label="새 탭 추가" aria-expanded={tabs.createMenuOpen} title="새 탭" onClick={(event) => actions.toggleCreateMenu(event.currentTarget)}><Icon name="plus" /></button>}
        </div>
        {thread.id && <SessionGoalBanner
          key={threadKey}
          target={thread.target}
          provider={thread.provider}
          threadId={thread.id}
          cwd={thread.cwd}
          opening={thread.opening}
          hidden={tabs.active !== "chat"}
        />}
        {tabs.active === "chat" && thread.id && <>
          <div className="conversation-scroll-frame">
            <div className="conversation-scroll" ref={conversationRef} onScroll={onScroll}>
              <div className="conversation-inner">
                <div className="conversation-date"><span />{thread.targetLabel} · {thread.id.slice(0, 8)}<span /></div>
                {thread.opening && <div className="inline-state">원격 대화 기록을 가져오는 중…</div>}
                {!thread.opening && !thread.entries.length && <div className="empty-conversation"><div className="empty-icon"><Icon name="message" /></div><h2>대화 기록이 없습니다</h2><p>메시지를 보내면 {thread.providerName}가 이 세션을 이어갑니다.</p></div>}
                {responseGroups.map((group, groupIndex) => <Fragment key={group.id}>
                  {hasOlder && groupIndex === 10 && <div ref={historySentinelRef} className="transcript-history-sentinel" aria-hidden="true" />}
                  {group.blocks.map((block) => {
                    if (block.kind === "activity") return <TranscriptActivityGroup key={block.id} entries={block.entries} />;
                    const threadIdle = groupIndex < responseGroups.length - 1 || !thread.unfinishedResponse;
                    const copyText = assistantResponseTextForEntry(block.entry, group.entries, threadIdle);
                    const canFork = canForkTranscriptEntry(block.entry, copyText !== undefined);
                    return <Transcript
                      key={block.entry.id}
                      entry={block.entry}
                      cwd={thread.cwd}
                      onOpenFile={actions.openFile}
                      copyText={copyText}
                      responseDurationMs={block.entry.responseDurationMs}
                      onFork={canFork ? () => actions.forkResponse(block.entry) : undefined}
                      forking={thread.forkingEntryId === block.entry.id}
                    />;
                  })}
                </Fragment>)}
                {thread.busy && <div className="working-indicator"><span /><span /><span /> 응답을 작성하고 있습니다 · {formatElapsed(thread.busyElapsed)}</div>}
              </div>
            </div>
            {showJumpToLatest && <button className="conversation-jump-latest" type="button" onClick={jumpToLatest} aria-label="최신 대화로 이동" title="최신 대화로 이동"><Icon name="chevron-down" /><span>최신 내역</span></button>}
          </div>
          <Composer {...composer} />
        </>}
        {tabs.active === "chat" && !thread.id && (
          <div className="empty-state">
            <div className="empty-icon"><Icon name="message" /></div>
            <h2>{emptyState.connectionState === "connected" ? `${emptyState.providerName} 세션을 선택하세요` : `${emptyState.providerName}에 연결하세요`}</h2>
            <p>{emptyState.connectionState === "connected" ? "왼쪽에서 기존 세션을 선택하거나 현재 작업 공간에서 새 세션을 만드세요." : `${emptyState.providerName}에 연결하면 세션과 대화를 불러올 수 있습니다.`}</p>
            {emptyState.connectionState === "connected" ? <button className="dialog-primary" onClick={actions.openNewWorkspace} disabled={emptyState.creatingSession}>새 작업 공간</button> : <button onClick={actions.openConnectionSettings}>SSH 호스트 연결</button>}
            {emptyState.notice && <div className="inline-notice" role="status"><Icon name="info" />{emptyState.notice}</div>}
          </div>
        )}
        {terminalPanel && <div className="workspace-tab-panel" hidden={tabs.active !== "terminal"}>{terminalPanel}</div>}
        {tabs.activeFile && tabs.active === `file:${tabs.activeFile.id}` && <Suspense fallback={<div className="inline-state" role="status">파일 미리보기를 불러오는 중…</div>}><FileDocument file={tabs.activeFile.file} /></Suspense>}
      </section>
    </div>
    {tabs.createMenuOpen && tabs.createMenuPosition && createPortal(<div ref={tabs.createMenuRef} className="tab-create-menu" style={tabs.createMenuPosition} role="menu">
      <button type="button" role="menuitem" disabled={!thread.target || !thread.cwd || tabs.creatingSession || thread.opening} onClick={() => { actions.closeCreateMenu(); actions.openNewSession(); }}><Icon name="message" /><span>{tabs.creatingSession ? "여는 중…" : "새 세션"}</span></button>
      {!tabs.terminal && <button type="button" role="menuitem" disabled={!thread.target || !thread.cwd} onClick={actions.openTerminalTab}><Icon name="terminal" /><span>터미널</span></button>}
    </div>, document.body)}
    {tabSwitcherOpen && createPortal(<div className="workspace-tabs-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTabSwitcherOpen(false); }}>
      <section className="workspace-tabs-sheet" role="dialog" aria-modal="true" aria-labelledby="workspace-tabs-sheet-title">
        <header className="workspace-tabs-sheet-header"><div><h2 id="workspace-tabs-sheet-title">열린 탭</h2><span>{tabItems.length}개</span></div><button className="icon-button" type="button" aria-label="탭 목록 닫기" title="닫기" onClick={() => setTabSwitcherOpen(false)}><Icon name="close" /></button></header>
        {tabItems.length >= 6 && <input className="workspace-tabs-sheet-search" type="search" value={tabSearch} onChange={(event) => setTabSearch(event.target.value)} placeholder="탭 검색" aria-label="열린 탭 검색" />}
        <div className="workspace-tabs-sheet-list" role="list">
          {filteredTabItems.map((item) => <div className={`workspace-tabs-sheet-row ${item.active ? "active" : ""}`} key={item.id} role="listitem">
            <button className="workspace-tabs-sheet-select" type="button" aria-current={item.active ? "page" : undefined} onClick={() => { item.onSelect(); setTabSwitcherOpen(false); }}>
              <Icon name={item.icon} /><span>{item.title}</span>{item.active && <small>현재</small>}
            </button>
            {item.onRename && <button className="workspace-tabs-sheet-action" type="button" aria-label={`${item.title} 이름 변경`} title="이름 변경" onClick={() => { item.onRename?.(); setTabSwitcherOpen(false); }}><Icon name="edit" /></button>}
            {item.onClose && <button className="workspace-tabs-sheet-action" type="button" aria-label={`${item.title} 탭 닫기`} title="탭 닫기" onClick={item.onClose}><Icon name="close" /></button>}
          </div>)}
          {!filteredTabItems.length && <p className="workspace-tabs-sheet-empty">일치하는 탭이 없습니다.</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}
