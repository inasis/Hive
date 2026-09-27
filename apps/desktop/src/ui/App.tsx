import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { bridgeRpc, isDaemonClient, isLinuxDesktop, isMobileApp, setAndroidStatusBarAppearance, setAssistantProvider } from "./bridgeClient";
import { ASSISTANT_PROVIDERS } from "../../../../src/assistant-providers";
import { FileDocument, FilesPanel, TerminalPanel, type WorkspaceFileOpenRequest } from "./WorkspacePanels";
import { useSpringUiMotion } from "./useSpringUiMotion";
import type { AssistantProvider, AssistantProviderInfo, BridgeEvent, GtkSettings, GtkTitleButtonRaster, PromptImageAttachment, RemoteCommand, RemoteMode, RemoteModel, RemoteSkill, RemoteThread, TranscriptEntry, WorkspaceFileText } from "../shared/bridge";

type ConnectionState = "disconnected" | "connecting" | "connected";
type Theme = "dark" | "light";
type AppPage = "sessions" | "skills" | "settings";
type SettingsSection = "connection" | "theme";
type Project = { key: string; name: string; path: string; sessions: RemoteThread[] };
type Approval = { requestId: number | string; method: string; params: Record<string, unknown>; provider: AssistantProvider };
type ThreadView = { target: string; threadId: string; provider: AssistantProvider; title: string; cwd: string; model: string; effort: string | null; permissionProfile: string | null; modes: RemoteMode[]; currentModeId: string | null; entries: TranscriptEntry[]; skills: RemoteSkill[]; skillWarnings: string[] };
type SideChatTab = { target: string; threadId: string; provider: AssistantProvider; parentThreadId: string; rootThreadId: string; label: string; persistent?: boolean };
type WorkspaceFileTab = { id: string; target: string; cwd: string; file: WorkspaceFileText };
type WorkspaceTab = "chat" | "terminal" | `file:${string}`;
type TranscriptBlock = { kind: "entry"; entry: TranscriptEntry } | { kind: "activity"; id: string; entries: TranscriptEntry[] };
type SlashMenuItem = { kind: "skill"; skill: RemoteSkill } | { kind: "command"; command: RemoteCommand };
type WindowResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type WindowResizeState = {
  edge: WindowResizeEdge;
  pointerId: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  frame?: { x: number; y: number; width: number; height: number };
  scaleX?: number;
  scaleY?: number;
  sentX?: number;
  sentY?: number;
  inFlight: boolean;
  scheduled: boolean;
  released: boolean;
};
type LocalImageAttachment = PromptImageAttachment & { id: string };
const WINDOW_RESIZE_EDGES: WindowResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const LOCAL_MOBILE_TARGET = "hive-local://";
const PERSISTENT_FORK_TABS_KEY = "hive.persistentForkTabs.v1";
const FALLBACK_DECORATION_LAYOUT = { layout: "menu:minimize,maximize,close", left: ["menu"], right: ["minimize", "maximize", "close"] };
const PERMISSION_PRESETS = [
  { id: ":read-only", label: "읽기 전용", description: "파일을 읽을 수 있으며 수정이나 네트워크 접근에는 승인이 필요합니다." },
  { id: ":workspace", label: "기본", description: "현재 워크스페이스에서 파일을 수정할 수 있습니다." },
  { id: ":danger-full-access", label: "전체 접근", description: "워크스페이스 외부 파일과 네트워크에도 승인 없이 접근합니다." },
] as const;
const KIRO_POLICY_PRESETS = [
  { id: "read-workspace", label: "워크스페이스 읽기", description: "현재 워크스페이스의 파일을 읽도록 허용합니다." },
  { id: "edit-workspace", label: "워크스페이스 편집", description: "현재 워크스페이스 파일 편집을 허용합니다." },
  { id: "read-all", label: "전체 파일 읽기", description: "워크스페이스 밖을 포함해 파일 읽기를 허용합니다." },
  { id: "read-only-shell", label: "읽기 전용 셸", description: "읽기 전용으로 분류된 셸 명령을 허용합니다." },
  { id: "dev-shell", label: "개발 셸", description: "개발 작업에 필요한 셸 명령을 허용합니다." },
  { id: "allow-all", label: "모든 도구 허용", description: "Kiro 도구 실행을 자동 허용합니다." },
] as const;

export function App({ onMobileDisconnect, onUseDirectConnection, onUseDaemonConnection }: {
  onMobileDisconnect?: () => void;
  onUseDirectConnection?: () => void;
  onUseDaemonConnection?: () => void;
} = {}) {
  const [theme, setTheme] = useState<Theme>(() => {
    const storedTheme = localStorage.getItem("hive.theme");
    if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const savedTarget = localStorage.getItem("hive.sshTarget") ?? "";
  const [assistantProvider, setAssistantProviderState] = useState<AssistantProvider>(() => readAppAssistantProvider());
  const [availableProviders, setAvailableProviders] = useState<AssistantProviderInfo[]>(() => [...ASSISTANT_PROVIDERS]);
  const [target, setTarget] = useState(isDaemonClient ? LOCAL_MOBILE_TARGET : savedTarget);
  const [activePage, setActivePage] = useState<AppPage>(() => isDaemonClient || savedTarget ? "sessions" : "settings");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("connection");
  const [connectedTarget, setConnectedTarget] = useState("");
  const [connectedProvider, setConnectedProvider] = useState<AssistantProvider>(assistantProvider);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [threads, setThreads] = useState<RemoteThread[]>([]);
  const [providerCatalogs, setProviderCatalogs] = useState<Partial<Record<AssistantProvider, { models: RemoteModel[]; warning: string }>>>({});
  const [activeThreadId, setActiveThreadId] = useState("");
  const [activeThreadProvider, setActiveThreadProvider] = useState<AssistantProvider | null>(null);
  const [activeSideChatId, setActiveSideChatId] = useState("");
  const [sideChats, setSideChats] = useState<SideChatTab[]>(readPersistentForkTabs);
  const [creatingSideChat, setCreatingSideChat] = useState(false);
  const [forkingEntryId, setForkingEntryId] = useState("");
  const [activeTitle, setActiveTitle] = useState("");
  const [activeCwd, setActiveCwd] = useState("");
  const [currentModel, setCurrentModel] = useState("");
  const [modelSettingsDialogOpen, setModelSettingsDialogOpen] = useState(false);
  const [currentEffort, setCurrentEffort] = useState<string | null>(null);
  const [currentPermissionProfile, setCurrentPermissionProfile] = useState<string | null>(null);
  const [currentModes, setCurrentModes] = useState<RemoteMode[]>([]);
  const [currentModeId, setCurrentModeId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [skills, setSkills] = useState<RemoteSkill[]>([]);
  const [skillWarnings, setSkillWarnings] = useState<string[]>([]);
  const [slashCommands, setSlashCommands] = useState<RemoteCommand[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<RemoteSkill | null>(null);
  const [slashSkillLoading, setSlashSkillLoading] = useState(false);
  const [slashSkillIndex, setSlashSkillIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("chat");
  const [terminalContext, setTerminalContext] = useState<{ target: string; cwd: string } | null>(null);
  const [tabCreateMenuOpen, setTabCreateMenuOpen] = useState(false);
  const [tabCreateMenuPosition, setTabCreateMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [workspaceFileTabs, setWorkspaceFileTabs] = useState<WorkspaceFileTab[]>([]);
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [filePanelInitialized, setFilePanelInitialized] = useState(false);
  const [workspaceFileOpenRequest, setWorkspaceFileOpenRequest] = useState<WorkspaceFileOpenRequest | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([]);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [newSessionDialogMode, setNewSessionDialogMode] = useState<"workspace" | "session">("workspace");
  const [newSessionPath, setNewSessionPath] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [newKiroPolicyPresets, setNewKiroPolicyPresets] = useState<string[]>([]);
  const [newSessionError, setNewSessionError] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const [choosingWorkspaceFolder, setChoosingWorkspaceFolder] = useState(false);
  const [renameDialog, setRenameDialog] = useState<{ threadId: string; provider: AssistantProvider; title: string } | null>(null);
  const [renameSessionName, setRenameSessionName] = useState("");
  const [renameSessionError, setRenameSessionError] = useState("");
  const [renamingSession, setRenamingSession] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<RemoteThread | null>(null);
  const [deleteSessionError, setDeleteSessionError] = useState("");
  const [deletingSession, setDeletingSession] = useState(false);
  const [draft, setDraft] = useState("");
  const [imageAttachments, setImageAttachments] = useState<LocalImageAttachment[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState("");
  const [stoppingTurn, setStoppingTurn] = useState(false);
  const [steeringPrompt, setSteeringPrompt] = useState(false);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [busyElapsed, setBusyElapsed] = useState(0);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [gtkSettings, setGtkSettings] = useState<GtkSettings | null>(null);
  const [gtkMenuOpen, setGtkMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(() => window.matchMedia("(min-width: 681px)").matches);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [openingThread, setOpeningThread] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [filter, setFilter] = useState("");
  const [skillProvider, setSkillProvider] = useState("전체 제공자");

  const openSettings = (section: SettingsSection = settingsSection) => {
    setSettingsSection(section);
    setActivePage("settings");
    setMobileSidebarOpen(false);
  };

  useEffect(() => {
    const media = window.matchMedia("(min-width: 681px)");
    const update = () => setIsWideLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const filesPanelRef = useRef<HTMLElement>(null);
  const slashSkillRefreshSequence = useRef(0);
  const tabCreateMenuRef = useRef<HTMLDivElement>(null);
  const tabCreateButtonRef = useRef<HTMLButtonElement>(null);
  const windowResizeRef = useRef<WindowResizeState | null>(null);
  const assistantDeltaBuffer = useRef(new Map<string, { text: string; turnId: string; providerMessageId: string }>());
  const assistantDeltaTimer = useRef<number | null>(null);
  const threadViews = useRef(new Map<string, ThreadView>());
  const draftsByThread = useRef(new Map<string, string>());
  const imageAttachmentsByThread = useRef(new Map<string, LocalImageAttachment[]>());
  const turnInProgress = useRef(false);
  const runningThreads = useRef(new Map<string, number>());
  const runningTurnIds = useRef(new Map<string, string>());
  const observedTurnStarts = useRef(new Set<string>());
  const interruptedTurns = useRef(new Set<string>());
  const activeThreadContext = useRef({ target: "", threadId: "", provider: assistantProvider });
  const workspaceFileOpenSequence = useRef(0);
  const connectSequence = useRef(0);

  useSpringUiMotion({
    rootRef: appShellRef,
    sidebarRef,
    filesPanelRef,
    desktopSidebarCollapsed,
    mobileSidebarOpen,
    filePanelInitialized,
    filePanelOpen,
    activePage,
    isMobileApp,
    isWideLayout,
  });

  useEffect(() => setAssistantProvider(assistantProvider), [assistantProvider]);

  useEffect(() => {
    try {
      localStorage.setItem(PERSISTENT_FORK_TABS_KEY, JSON.stringify(sideChats.filter((chat) => chat.persistent)));
    } catch {}
  }, [sideChats]);

  useEffect(() => {
    let disposed = false;
    void bridgeRpc.request.listProviders({}).then((result) => {
      if (disposed) return;
      const providersById = new Map(ASSISTANT_PROVIDERS.map((provider) => [provider.id, provider]));
      for (const provider of result.providers) providersById.set(provider.id, provider);
      setAvailableProviders([...providersById.values()]);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  const openWorkspaceMarkdownFile = useCallback((path: string) => {
    if (!connectedTarget || !activeCwd) return;
    const id = ++workspaceFileOpenSequence.current;
    setWorkspaceFileOpenRequest({ id, target: connectedTarget, cwd: activeCwd, path });
    setFilePanelInitialized(true);
    setFilePanelOpen(true);
  }, [connectedTarget, activeCwd]);
  const openWorkspaceFileTab = useCallback((target: string, cwd: string, file: WorkspaceFileText) => {
    const id = `${target}\0${cwd}\0${file.path}`;
    setWorkspaceFileTabs((current) => {
      const existingIndex = current.findIndex((tab) => tab.id === id);
      if (existingIndex < 0) return [...current, { id, target, cwd, file }];
      const next = [...current];
      next[existingIndex] = { id, target, cwd, file };
      return next;
    });
    setActiveTab(`file:${id}`);
    if (isMobileApp || window.matchMedia("(max-width: 900px)").matches) setFilePanelOpen(false);
  }, []);
  const handleWorkspaceFileOpenHandled = useCallback((id: number) => {
    setWorkspaceFileOpenRequest((current) => current?.id === id ? null : current);
  }, []);

  const updateThreadEntries = useCallback((target: string, provider: AssistantProvider, threadId: string, update: (current: TranscriptEntry[]) => TranscriptEntry[]) => {
    const key = threadViewKey(target, provider, threadId);
    const view = threadViews.current.get(key);
    const nextEntries = update(view?.entries ?? []);
    if (view) threadViews.current.set(key, { ...view, entries: nextEntries });
    if (activeThreadContext.current.target === target && activeThreadContext.current.provider === provider && activeThreadContext.current.threadId === threadId) {
      setEntries(nextEntries);
    }
  }, []);

  const addKiroImages = async (files: File[]) => {
    if (threadProvider !== "kiro" || busy || !connectedTarget || !activeThreadId) return;
    const key = threadViewKey(connectedTarget, threadProvider, activeThreadId);
    const next = [...(imageAttachmentsByThread.current.get(key) ?? imageAttachments)];
    let totalBytes = next.reduce((total, image) => total + Math.max(0, Math.floor(image.data.length * 3 / 4) - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0)), 0);
    const skipped: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/") || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type.toLowerCase())) {
        skipped.push(`${file.name}: 지원하지 않는 이미지 형식`);
        continue;
      }
      if (next.length >= 4 || file.size > 4 * 1024 * 1024 || totalBytes + file.size > 8 * 1024 * 1024) {
        skipped.push(`${file.name}: 이미지 최대 4개, 파일당 4MB, 전체 8MB까지 첨부할 수 있습니다.`);
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        next.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name.slice(0, 200), mimeType: file.type.toLowerCase(), data: btoa(binary) });
        totalBytes += file.size;
      } catch {
        skipped.push(`${file.name}: 이미지를 읽지 못했습니다.`);
      }
    }
    imageAttachmentsByThread.current.set(key, next);
    if (activeThreadContext.current.target === connectedTarget && activeThreadContext.current.provider === "kiro" && activeThreadContext.current.threadId === activeThreadId) {
      setImageAttachments(next);
      if (next.length) setDraft((current) => current.trim() ? current : "첨부한 이미지를 확인해 주세요.");
      setNotice(skipped.length ? skipped.join(" · ") : "");
    }
  };

  const removeKiroImage = (attachmentId: string) => {
    if (!connectedTarget || !activeThreadId) return;
    const key = threadViewKey(connectedTarget, threadProvider, activeThreadId);
    const next = (imageAttachmentsByThread.current.get(key) ?? imageAttachments).filter((image) => image.id !== attachmentId);
    imageAttachmentsByThread.current.set(key, next);
    setImageAttachments(next);
    if (!next.length) setDraft((current) => current === "첨부한 이미지를 확인해 주세요." ? "" : current);
  };

  const flushAssistantDeltas = useCallback(() => {
    if (assistantDeltaTimer.current !== null) {
      window.clearTimeout(assistantDeltaTimer.current);
      assistantDeltaTimer.current = null;
    }
    const pending = [...assistantDeltaBuffer.current];
    assistantDeltaBuffer.current.clear();
    if (!pending.length) return;
    for (const [key, delta] of pending) {
      const [target, provider, threadId, messageId] = key.split("\0");
      if (target && (provider === "codex" || provider === "opencode" || provider === "kiro") && threadId && messageId) {
        updateThreadEntries(target, provider, threadId, (current) => appendAssistantDelta(current, messageId, delta.text, delta.turnId, delta.providerMessageId));
      }
    }
  }, [updateThreadEntries]);

  const cacheActiveThreadView = (saveDraft = true, provider = activeThreadProvider ?? assistantProvider) => {
    if (!connectedTarget || !activeThreadId) return;
    const key = threadViewKey(connectedTarget, provider, activeThreadId);
    if (saveDraft) draftsByThread.current.set(key, draft);
    imageAttachmentsByThread.current.set(key, imageAttachments);
    const previous = threadViews.current.get(key);
    threadViews.current.set(key, {
      target: connectedTarget,
      threadId: activeThreadId,
      provider,
      title: activeTitle,
      cwd: activeCwd,
      model: currentModel,
      effort: currentEffort,
      permissionProfile: currentPermissionProfile,
      modes: currentModes,
      currentModeId,
      entries: previous?.entries ?? entries,
      skills,
      skillWarnings,
    });
  };

  const activateThreadView = (view: ThreadView, sideChatId = "") => {
    setWorkspaceFileOpenRequest(null);
    threadViews.current.set(threadViewKey(view.target, view.provider, view.threadId), view);
    activeThreadContext.current = { target: view.target, threadId: view.threadId, provider: view.provider };
    setConnectedTarget(view.target);
    setConnectedProvider(view.provider);
    setActiveThreadProvider(view.provider);
    setAssistantProviderState(view.provider);
    setAssistantProvider(view.provider);
    setActiveThreadId(view.threadId);
    slashSkillRefreshSequence.current += 1;
    setSlashCommands([]);
    setSelectedSkill(null);
    setSlashSkillLoading(false);
    setSlashSkillIndex(0);
    setActiveSideChatId(sideChatId);
    const viewKey = threadViewKey(view.target, view.provider, view.threadId);
    setDraft(draftsByThread.current.get(viewKey) ?? "");
    setImageAttachments(imageAttachmentsByThread.current.get(viewKey) ?? []);
    setActiveTitle(view.title);
    setActiveCwd(view.cwd);
    setCurrentModel(view.model);
    setCurrentEffort(view.effort);
    setCurrentPermissionProfile(view.permissionProfile);
    setCurrentModes(view.modes);
    setCurrentModeId(view.currentModeId);
    setEntries(view.entries);
    setSkills(view.skills);
    setSkillWarnings(view.skillWarnings);
    setActiveTab("chat");
    setActivePage("sessions");
    const runningSince = runningThreads.current.get(runningThreadKey(view.target, view.provider, view.threadId)) ?? null;
    setActiveTurnId(runningTurnIds.current.get(runningThreadKey(view.target, view.provider, view.threadId)) ?? "");
    setStoppingTurn(false);
    turnInProgress.current = runningSince !== null;
    setBusy(runningSince !== null);
    setBusySince(runningSince);
    setNotice("");
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#000000" : "#FFFFFF");
    setAndroidStatusBarAppearance(theme === "light");
  }, [theme]);

  useEffect(() => {
    if (!isMobileApp || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const updateViewportHeight = () => {
      document.documentElement.style.setProperty("--mobile-visual-height", `${viewport.height}px`);
      document.documentElement.style.setProperty("--mobile-visual-offset-top", `${Math.max(0, viewport.offsetTop)}px`);
    };
    updateViewportHeight();
    viewport.addEventListener("resize", updateViewportHeight);
    viewport.addEventListener("scroll", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);
    return () => {
      viewport.removeEventListener("resize", updateViewportHeight);
      viewport.removeEventListener("scroll", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
      document.documentElement.style.removeProperty("--mobile-visual-height");
      document.documentElement.style.removeProperty("--mobile-visual-offset-top");
    };
  }, []);

  useEffect(() => {
    if (!isLinuxDesktop) return;
    void bridgeRpc.request.windowAction({ action: "state" })
      .then((result) => setWindowMaximized(result.maximized))
      .catch(() => {});
    void bridgeRpc.request.getGtkSettings({})
      .then((settings) => {
        setGtkSettings(settings);
        if (localStorage.getItem("hive.theme") === null) setTheme(settings.gtk.dark ? "dark" : "light");
      })
      .catch(() => {});
  }, []);

  const gtkTopbarStyle = useMemo(() => makeGtkTopbarStyle(gtkSettings), [gtkSettings]);
  const gtkControlStyle = useMemo(() => makeGtkControlStyle(gtkSettings), [gtkSettings]);
  const decorationLayout = gtkSettings?.window.decorationLayout ?? FALLBACK_DECORATION_LAYOUT;
  const moveGtkTitleButtonsToSidebar = isLinuxDesktop && !desktopSidebarCollapsed;
  const sidebarGtkLeftDecorations = moveGtkTitleButtonsToSidebar
    ? decorationLayout.left.filter(isGtkTitleButtonDecoration)
    : [];
  const sidebarGtkRightDecorations = moveGtkTitleButtonsToSidebar
    ? decorationLayout.right.filter(isGtkTitleButtonDecoration)
    : [];
  const topbarGtkLeftDecorations = moveGtkTitleButtonsToSidebar
    ? decorationLayout.left.filter((item) => !isGtkTitleButtonDecoration(item))
    : decorationLayout.left;
  const topbarGtkRightDecorations = moveGtkTitleButtonsToSidebar
    ? decorationLayout.right.filter((item) => !isGtkTitleButtonDecoration(item))
    : decorationLayout.right;
  const renderGtkDecorations = (items: string[], side: "left" | "right") => items.map((item, index) => {
    const key = `${item}-${index}`;
    if (item === "icon") return <span className="window-decoration-icon" key={key} aria-label="Hive">H</span>;
    if (item === "menu") return <div className="window-menu-wrap" key={key} data-side={side}>
      <button className="window-control" type="button" aria-label="창 메뉴" title="창 메뉴" aria-expanded={gtkMenuOpen} onClick={() => setGtkMenuOpen((open) => !open)}><GtkWindowIcon source={gtkSettings?.icons.menu} fallback="menu" /></button>
      {gtkMenuOpen && <div className="window-menu-panel" role="menu">
        <button type="button" role="menuitem" onClick={() => { setActivePage("sessions"); setGtkMenuOpen(false); }}>세션</button>
        <button type="button" role="menuitem" onClick={() => { setActivePage("skills"); setGtkMenuOpen(false); }}>스킬</button>
        <button type="button" role="menuitem" onClick={() => { openSettings("connection"); setGtkMenuOpen(false); }}>연결 설정</button>
      </div>}
    </div>;
    if (item === "minimize") {
      const raster = gtkSettings?.titleButtons.minimize;
      return <button className={raster?.normal ? "window-control window-control-native" : "window-control"} style={nativeWindowButtonStyle(raster)} key={key} type="button" aria-label="최소화" title="최소화" onClick={() => void controlWindow("minimize")}><GtkTitleButton raster={raster} fallback="window-minimize" /></button>;
    }
    if (item === "maximize") {
      const raster = gtkSettings?.titleButtons[windowMaximized ? "restore" : "maximize"];
      return <button className={raster?.normal ? "window-control window-control-native" : "window-control"} style={nativeWindowButtonStyle(raster)} key={key} type="button" aria-label={windowMaximized ? "복원" : "최대화"} title={windowMaximized ? "복원" : "최대화"} onClick={() => void controlWindow("toggleMaximize")}><GtkTitleButton raster={raster} fallback={windowMaximized ? "window-restore" : "window-maximize"} /></button>;
    }
    if (item === "close") {
      const raster = gtkSettings?.titleButtons.close;
      return <button className={raster?.normal ? "window-control window-control-native" : "window-control"} style={nativeWindowButtonStyle(raster)} key={key} type="button" aria-label="닫기" title="닫기" onClick={() => void controlWindow("close")}><GtkTitleButton raster={raster} fallback="close" /></button>;
    }
    return null;
  });

  const projects = useMemo(() => groupThreads(threads), [threads]);
  const threadProvider = activeThreadProvider ?? assistantProvider;
  const threadProviderName = providerDisplayName(threadProvider);
  const activeModels = providerCatalogs[threadProvider];
  const models = activeModels?.models ?? [];
  const modelWarning = activeModels?.warning ?? "";
  const activeSideChat = sideChats.find((chat) => chat.target === connectedTarget && chat.provider === threadProvider && chat.threadId === activeThreadId);
  const chatRootThreadId = activeSideChat?.rootThreadId ?? activeThreadId;
  const visibleSideChats = sideChats.filter((chat) => chat.target === connectedTarget && chat.provider === threadProvider && chat.rootThreadId === chatRootThreadId);
  const activeThreadHasUnfinishedResponse = busy || Boolean(activeThreadId && runningThreads.current.has(runningThreadKey(connectedTarget, threadProvider, activeThreadId)));
  const mainThreadLabel = threads.find((thread) => thread.provider === threadProvider && thread.id === chatRootThreadId)?.title ??
    threadViews.current.get(threadViewKey(connectedTarget, threadProvider, chatRootThreadId))?.title ?? "원본 대화";
  const selectedModel = models.find((model) => model.model === currentModel);
  const assistantProviderName = providerDisplayName(assistantProvider);
  const activeFileTabId = activeTab.startsWith("file:") ? activeTab.slice("file:".length) : "";
  const activeFileTab = workspaceFileTabs.find((tab) => tab.id === activeFileTabId) ?? null;
  const reasoningOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const displayedEffort = currentEffort ?? selectedModel?.defaultReasoningEffort ?? "";
  const providers = useMemo(() => ["전체 제공자", ...new Set(skills.map((skill) => skill.provider))], [skills]);
  const visibleSkills = skills.filter((skill) => (skillProvider === "전체 제공자" || skill.provider === skillProvider) &&
    `${skill.name} ${skill.description} ${skill.provider} ${skill.scope}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const slashMenuOpen = activePage === "sessions" && activeTab === "chat" && Boolean(activeThreadId) && draft.startsWith("/") && !/\s/.test(draft);
  const slashSkillQuery = draft.replace(/^\/+/, "").toLowerCase();
  const visibleSlashSkills = skills.filter((skill) => skill.enabled &&
    `${skill.name} ${skill.description} ${skill.provider} ${skill.scope} ${skill.id}`.toLowerCase().includes(slashSkillQuery),
  );
  const visibleSlashCommands = slashCommands.filter((command) =>
    `${command.name} /${command.name} ${command.description} ${command.provider}`.toLowerCase().includes(slashSkillQuery),
  );
  const visibleSlashItems: SlashMenuItem[] = [
    ...visibleSlashCommands.map((command): SlashMenuItem => ({ kind: "command", command })),
    ...visibleSlashSkills.map((skill): SlashMenuItem => ({ kind: "skill", skill })),
  ];

  useEffect(() => setSlashSkillIndex(0), [slashSkillQuery]);

  useEffect(() => {
    if (!tabCreateMenuOpen) return;
    const dismissMenu = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!tabCreateMenuRef.current?.contains(target) && !tabCreateButtonRef.current?.contains(target)) setTabCreateMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabCreateMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismissMenu);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismissMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tabCreateMenuOpen]);

  const toggleTabCreateMenu = (button: HTMLButtonElement) => {
    if (tabCreateMenuOpen) {
      setTabCreateMenuOpen(false);
      return;
    }
    const bounds = button.getBoundingClientRect();
    setTabCreateMenuPosition({ top: bounds.bottom + 4, left: Math.min(bounds.left, Math.max(8, window.innerWidth - 158)) });
    setTabCreateMenuOpen(true);
  };

  useEffect(() => {
    const onEvent = (event: BridgeEvent) => {
      const params = asObject(event.params) ?? {};
      if (event.method === "hive/transport/disconnected") {
        if (isDaemonClient) {
          setConnectionState("connecting");
          setNotice("데몬 연결이 끊어졌습니다. 자동으로 다시 연결하고 있습니다…");
        }
        return;
      }
      if (event.method === "hive/transport/failed") {
        if (isDaemonClient) {
          setConnectionState("disconnected");
          setNotice(typeof params.message === "string" ? params.message : "데몬 연결을 복구하지 못했습니다. 연결 설정을 확인하세요.");
        }
        return;
      }
      if (event.method === "hive/transport/keepalive-failed") {
        if (isMobileApp) setNotice(`백그라운드 연결 유지 서비스를 시작하지 못했습니다: ${typeof params.message === "string" ? params.message : "Android 서비스 오류"}`);
        return;
      }
      if (event.method === "hive/transport/reconnected") {
        if (!isDaemonClient) return;
        setConnectionState("connecting");
        setNotice("데몬 연결이 복구되었습니다. 세션 목록을 불러오는 중…");
        void bridgeRpc.request.connect({
          target: LOCAL_MOBILE_TARGET,
          provider: assistantProvider,
        })
          .then((result) => {
            setTarget(LOCAL_MOBILE_TARGET);
            setConnectedTarget(LOCAL_MOBILE_TARGET);
            setThreads((current) => replaceProviderThreads(current, result.threads, assistantProvider));
            setProviderCatalogs((current) => ({ ...current, [assistantProvider]: { models: result.models, warning: result.modelWarning ?? "" } }));
            setConnectionState("connected");
            setActivePage("sessions");
            setConnectedProvider(assistantProvider);
            setNotice(`데몬 연결이 복구되었습니다 · ${providerDisplayName(assistantProvider)} 세션 ${result.threads.length}개`);
            loadAdditionalProviderThreads(LOCAL_MOBILE_TARGET, assistantProvider);
          })
          .catch((error) => {
            setConnectionState("disconnected");
            setNotice(`데몬에는 다시 연결했지만 ${providerDisplayName(assistantProvider)} 세션을 불러오지 못했습니다: ${errorMessage(error)}`);
          });
        return;
      }
      if (event.target !== connectedTarget) return;
      const eventProvider = event.provider ?? assistantProvider;
      const threadKey = runningThreadKey(event.target, eventProvider, event.threadId);
      const isActiveThread = eventProvider === threadProvider && event.threadId === activeThreadId;
      const item = asObject(params.item) ?? {};
      if (event.requestId !== undefined) {
        setApproval({ requestId: event.requestId, method: event.method, params, provider: event.provider ?? assistantProvider });
        return;
      }
      if (event.method === "thread/name/updated") {
        const title = typeof params.name === "string" ? params.name.trim() : "";
        if (!title) return;
        setThreads((current) => current.map((thread) => thread.provider === eventProvider && thread.id === event.threadId ? { ...thread, title } : thread));
        const viewKey = threadViewKey(event.target, eventProvider, event.threadId);
        const view = threadViews.current.get(viewKey);
        if (view) threadViews.current.set(viewKey, { ...view, title });
        if (isActiveThread) setActiveTitle(title);
        return;
      }
      if (event.method === "thread/deleted") {
        const deletedThreadId = event.threadId || stringValue(params.threadId) || stringValue(params.thread_id);
        if (!deletedThreadId) return;
        const deletedViewKey = threadViewKey(event.target, eventProvider, deletedThreadId);
        threadViews.current.delete(deletedViewKey);
        draftsByThread.current.delete(deletedViewKey);
        imageAttachmentsByThread.current.delete(deletedViewKey);
        runningThreads.current.delete(deletedViewKey);
        runningTurnIds.current.delete(deletedViewKey);
        observedTurnStarts.current.delete(deletedViewKey);
        interruptedTurns.current.delete(deletedViewKey);
        setThreads((current) => current.filter((thread) => thread.provider !== eventProvider || thread.id !== deletedThreadId));
        setSideChats((current) => current.filter((chat) => chat.target !== event.target || chat.provider !== eventProvider || (chat.threadId !== deletedThreadId && chat.rootThreadId !== deletedThreadId)));
        for (const deltaKey of assistantDeltaBuffer.current.keys()) {
          if (deltaKey.startsWith(`${event.target}\0${eventProvider}\0${deletedThreadId}\0`)) assistantDeltaBuffer.current.delete(deltaKey);
        }
        return;
      }
      if (event.method === "thread/transcript/cleared") {
        updateThreadEntries(event.target, eventProvider, event.threadId, () => []);
        return;
      }
      if (event.method === "turn/started" || event.method === "item/agentMessage/delta") {
        const startedAt = runningThreads.current.get(threadKey) ?? Date.now();
        runningThreads.current.set(threadKey, startedAt);
        observedTurnStarts.current.add(threadKey);
        const turnId = stringValue(asObject(params.turn)?.id);
        if (turnId) {
          runningTurnIds.current.set(threadKey, turnId);
          if (isActiveThread) setActiveTurnId(turnId);
        }
        if (isActiveThread) {
          turnInProgress.current = true;
          setBusy(true);
          setBusySince((current) => current ?? startedAt);
        }
      }
      if (event.method === "turn/completed") {
        runningThreads.current.delete(threadKey);
        runningTurnIds.current.delete(threadKey);
        observedTurnStarts.current.delete(threadKey);
        const userInterrupted = interruptedTurns.current.delete(threadKey);
        const completedTurnId = stringValue(asObject(params.turn)?.id);
        flushAssistantDeltas();
        updateThreadEntries(event.target, eventProvider, event.threadId, (current) => current.map((entry) =>
          entry.role === "assistant" && (completedTurnId ? entry.turnId === completedTurnId : entry.status === "inProgress")
            ? { ...entry, status: "completed", responseCompleted: true }
            : entry,
        ));
        if (!isActiveThread) return;
        turnInProgress.current = false;
        setBusy(false);
        setActiveTurnId("");
        setStoppingTurn(false);
        setSteeringPrompt(false);
        setBusySince(null);
        const turn = asObject(params.turn);
        const error = asObject(turn?.error);
        if (!userInterrupted && typeof error?.message === "string") setNotice(`${providerDisplayName(eventProvider)} 오류: ${error.message}`);
        return;
      }
      if (event.provider && event.provider !== threadProvider) return;
      if (event.method === "thread/settings/updated") {
        const settings = asObject(params.threadSettings);
        const viewKey = threadViewKey(event.target, eventProvider, event.threadId);
        const view = threadViews.current.get(viewKey);
        if (view) {
          const model = typeof settings?.model === "string" ? settings.model : view.model;
          const effort = stringValue(settings?.effort) ?? null;
          const permissionProfile = stringValue(asObject(settings?.activePermissionProfile)?.id) ?? view.permissionProfile;
          const currentModeId = stringValue(settings?.currentModeId) ?? view.currentModeId;
          threadViews.current.set(viewKey, { ...view, model, effort, permissionProfile, currentModeId });
          if (isActiveThread) {
            setCurrentModel(model);
            setCurrentEffort(effort);
            setCurrentPermissionProfile(permissionProfile);
            setCurrentModeId(currentModeId);
          }
        }
        const supportedReasoningEfforts = Array.isArray(settings?.supportedReasoningEfforts)
          ? settings.supportedReasoningEfforts.filter((item): item is { reasoningEffort: string; description: string } => {
            const option = asObject(item);
            return typeof option?.reasoningEffort === "string" && typeof option.description === "string";
          })
          : undefined;
        if (supportedReasoningEfforts) {
          setProviderCatalogs((current) => {
            const catalog = current[eventProvider];
            if (!catalog) return current;
            const selectedModel = stringValue(settings?.model) ?? view?.model;
            if (!selectedModel) return current;
            return { ...current, [eventProvider]: { ...catalog, models: catalog.models.map((model) => model.model === selectedModel ? { ...model, supportedReasoningEfforts } : model) } };
          });
        }
        return;
      }
      if (event.method === "thread/commands/updated") {
        const incoming = Array.isArray(params.commands) ? params.commands.flatMap((item): RemoteCommand[] => {
          const command = asObject(item);
          return typeof command?.name === "string" ? [{ name: command.name, description: stringValue(command.description) ?? "", provider: stringValue(command.provider) ?? "Kiro", takesArguments: command.takesArguments === true }] : [];
        }) : [];
        if (isActiveThread) setSlashCommands(incoming);
        return;
      }
      if (event.method === "item/agentMessage/delta") {
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (!delta) return;
        const turnId = stringValue(params.turnId) ?? "turn";
        const providerMessageId = stringValue(params.itemId) ?? "assistant";
        const id = `${turnId}:${providerMessageId}`;
        const key = `${threadViewKey(event.target, eventProvider, event.threadId)}\0${id}`;
        const previous = assistantDeltaBuffer.current.get(key);
        assistantDeltaBuffer.current.set(key, { text: (previous?.text ?? "") + delta, turnId, providerMessageId });
        if (assistantDeltaTimer.current === null) {
          assistantDeltaTimer.current = window.setTimeout(flushAssistantDeltas, 50);
        }
      } else if (event.method === "item/started") {
        const id = stringValue(item.id) ?? `item-${Date.now()}`;
        if (item.type === "commandExecution") {
          updateThreadEntries(event.target, eventProvider, event.threadId, (current) => upsertEntry(current, {
            id, role: "tool", text: "실행 중", toolType: "commandExecution", command: displayValue(item.command), output: "", status: "inProgress",
          }));
        } else if (item.type === "fileChange") {
          updateThreadEntries(event.target, eventProvider, event.threadId, (current) => upsertEntry(current, { id, role: "change", text: "파일 변경 준비 중", status: "inProgress" }));
        } else if (item.type === "webSearch") {
          const searchEntries = webSearchTranscriptEntries(item, id, "inProgress");
          updateThreadEntries(event.target, eventProvider, event.threadId, (current) => replaceWebSearchEntries(current, id, searchEntries));
        }
      } else if (event.method === "item/completed") {
        const id = stringValue(item.id);
        if (id && item.type === "commandExecution") {
          updateThreadEntries(event.target, eventProvider, event.threadId, (current) => upsertEntry(current, {
            id,
            role: "tool",
            text: stringValue(item.status) ?? "완료",
            toolType: "commandExecution",
            command: displayValue(item.command),
            output: stringValue(item.aggregatedOutput) ?? stringValue(item.output) ?? "",
            status: stringValue(item.status) ?? "completed",
          }));
        } else if (id && item.type === "fileChange") {
          updateThreadEntries(event.target, eventProvider, event.threadId, (current) => upsertEntry(current, {
            id, role: "change", text: fileChangeSummary(item), status: stringValue(item.status) ?? "completed",
          }));
        } else if (id && item.type === "webSearch") {
          const searchEntries = webSearchTranscriptEntries(item, id, stringValue(item.status) ?? "completed");
          updateThreadEntries(event.target, eventProvider, event.threadId, (current) => replaceWebSearchEntries(current, id, searchEntries));
        } else if (id && item.type === "agentMessage") {
          const text = stringValue(item.text) ?? contentText(item.content);
          const turnId = stringValue(params.turnId) ?? "turn";
          flushAssistantDeltas();
          if (text) updateThreadEntries(event.target, eventProvider, event.threadId, (current) => {
            const messageId = `${turnId}:${id}`;
            const streamedText = current.find((entry) => entry.id === messageId)?.text ?? "";
            return upsertEntry(current, {
              id: messageId,
              role: "assistant",
              text: streamedText.length > text.length ? streamedText : text,
              turnId,
              providerMessageId: id,
              responseCompleted: false,
              status: "completed",
            });
          });
        }
      } else if (event.method === "warning") {
        if (isActiveThread && typeof params.message === "string") setNotice(`${providerDisplayName(eventProvider)} 알림: ${params.message}`);
      }
    };
    bridgeRpc.addMessageListener("event", onEvent);
    return () => bridgeRpc.removeMessageListener("event", onEvent);
  }, [activeThreadId, assistantProvider, threadProvider, connectedTarget, flushAssistantDeltas, updateThreadEntries]);

  useEffect(() => () => {
    if (assistantDeltaTimer.current !== null) window.clearTimeout(assistantDeltaTimer.current);
  }, []);

  useEffect(() => {
    if (busySince === null) {
      setBusyElapsed(0);
      return;
    }
    const updateElapsed = () => setBusyElapsed(Math.floor((Date.now() - busySince) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [busySince]);

  useEffect(() => {
    const scroll = conversationRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [entries, busy]);

  const connect = async (event?: FormEvent, targetOverride?: string, providerOverride?: AssistantProvider) => {
    event?.preventDefault();
    const sequence = ++connectSequence.current;
    const selectedProvider = providerOverride ?? assistantProvider;
    const requestedTarget = (targetOverride ?? target).trim() || (selectedProvider !== "codex" || isDaemonClient ? LOCAL_MOBILE_TARGET : "");
    if (!requestedTarget) return false;
    const sameTargetProviderSwitch = connectedTarget === requestedTarget && connectedProvider !== selectedProvider;
    if (activeThreadId && connectedTarget) cacheActiveThreadView(true, activeThreadProvider ?? connectedProvider);
    setAssistantProviderState(selectedProvider);
    setAssistantProvider(selectedProvider);
    setConnectionState("connecting");
    setNotice(`${providerDisplayName(selectedProvider)}${selectedProvider === "opencode" ? " 서버" : ""}로 연결하는 중…`);
    try {
      if (connectedTarget && (connectedTarget !== requestedTarget || connectedProvider !== selectedProvider)) {
        if (!sameTargetProviderSwitch) {
          await disconnectProviderSessions(connectedTarget);
          if (sequence !== connectSequence.current) return false;
          threadViews.current.clear();
          draftsByThread.current.clear();
          setThreads([]);
          setSideChats([]);
          setTerminalContext(null);
          setActiveSideChatId("");
          setActiveThreadId("");
          setActiveThreadProvider(null);
          setActiveTitle("");
          setActiveCwd("");
          setDraft("");
          setEntries([]);
          setSkills([]);
          setSkillWarnings([]);
          setSlashCommands([]);
          setProviderCatalogs({});
          setCurrentModel("");
          setCurrentEffort(null);
          setCurrentPermissionProfile(null);
          setActiveTab("chat");
          activeThreadContext.current = { target: "", threadId: "", provider: selectedProvider };
        }
      }
      const result = await connectProvider(requestedTarget, selectedProvider);
      if (sequence !== connectSequence.current) return false;
      if (!isDaemonClient && requestedTarget !== LOCAL_MOBILE_TARGET) localStorage.setItem("hive.sshTarget", requestedTarget);
      setTarget(requestedTarget);
      setConnectedTarget(requestedTarget);
      setConnectedProvider(selectedProvider);
      if (sameTargetProviderSwitch) {
        setActiveSideChatId("");
        setActiveThreadId("");
        setActiveThreadProvider(null);
        setActiveTitle("");
        setActiveCwd("");
        setEntries([]);
        setSkills([]);
        setSkillWarnings([]);
        setSlashCommands([]);
        setSelectedSkill(null);
        setDraft("");
        setActiveTab("chat");
        activeThreadContext.current = { target: "", threadId: "", provider: selectedProvider };
      }
      setThreads((current) => requestedTarget === connectedTarget
        ? replaceProviderThreads(current, result.threads, selectedProvider)
        : replaceProviderThreads([], result.threads, selectedProvider));
      setProviderCatalogs((current) => ({ ...current, [selectedProvider]: { models: result.models, warning: result.modelWarning ?? "" } }));
      setConnectionState("connected");
      setActivePage("sessions");
      if (isMobileApp) setMobileSidebarOpen(true);
      setNotice(`${providerDisplayName(selectedProvider)} 연결됨 · 세션 ${result.threads.length}개. 왼쪽에서 이어갈 세션을 선택하세요.`);
      loadAdditionalProviderThreads(requestedTarget, selectedProvider);
      return true;
    } catch (error) {
      if (sequence !== connectSequence.current) return false;
      if (sameTargetProviderSwitch) {
        setConnectionState("connected");
        setAssistantProviderState(connectedProvider);
        setAssistantProvider(connectedProvider);
        setNotice(`${providerDisplayName(selectedProvider)} 연결 실패. 기존 ${providerDisplayName(connectedProvider)} 연결은 유지됩니다. ${errorMessage(error)}`);
      } else {
        setConnectionState("disconnected");
        setConnectedTarget("");
        if (isDaemonClient || connectedProvider !== selectedProvider) openSettings("connection");
        setNotice(errorMessage(error));
      }
      return false;
    }
  };

  const chooseProvider = (next: AssistantProvider, autoConnect = false) => {
    if (busy) return;
    setAssistantProviderState(next);
    setAssistantProvider(next);
    if (connectionState === "connected") {
      if (next === connectedProvider && next === assistantProvider) return;
      const requestedTarget = (connectedTarget || target).trim() || (next !== "codex" || isDaemonClient ? LOCAL_MOBILE_TARGET : "");
      if (requestedTarget) void connect(undefined, requestedTarget, next);
      else openSettings("connection");
      return;
    }
    if (!autoConnect) return;
    const requestedTarget = (connectedTarget || target).trim() || (next !== "codex" || isDaemonClient ? LOCAL_MOBILE_TARGET : "");
    if (requestedTarget) void connect(undefined, requestedTarget, next);
    else openSettings("connection");
  };

  useEffect(() => {
    if (!isDaemonClient) return;
    setTarget(LOCAL_MOBILE_TARGET);
    void connect(undefined, LOCAL_MOBILE_TARGET);
  }, []);

  const controlWindow = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const result = await bridgeRpc.request.windowAction({ action });
      setWindowMaximized(result.maximized);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const scheduleWindowResize = () => {
    const state = windowResizeRef.current;
    if (!state?.frame || state.inFlight || state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      const current = windowResizeRef.current;
      if (!current || current !== state) return;
      current.scheduled = false;
      const { frame, edge } = current;
      if (!frame) return;
      if (current.latestX === current.sentX && current.latestY === current.sentY) {
        if (current.released) windowResizeRef.current = null;
        return;
      }
      const dx = (current.latestX - current.startX) * (current.scaleX ?? 1);
      const dy = (current.latestY - current.startY) * (current.scaleY ?? 1);
      let { x, y, width, height } = frame;
      if (edge.includes("e")) width = Math.max(640, frame.width + dx);
      if (edge.includes("s")) height = Math.max(420, frame.height + dy);
      if (edge.includes("w")) {
        width = Math.max(640, frame.width - dx);
        x = frame.x + frame.width - width;
      }
      if (edge.includes("n")) {
        height = Math.max(420, frame.height - dy);
        y = frame.y + frame.height - height;
      }
      current.sentX = current.latestX;
      current.sentY = current.latestY;
      current.inFlight = true;
      void bridgeRpc.request.setWindowFrame({ x, y, width, height })
        .catch((error) => setNotice(errorMessage(error)))
        .finally(() => {
          current.inFlight = false;
          if (windowResizeRef.current === current) {
            if (current.latestX !== current.sentX || current.latestY !== current.sentY) scheduleWindowResize();
            else if (current.released) windowResizeRef.current = null;
          }
        });
    });
  };

  const beginWindowResize = async (event: ReactPointerEvent<HTMLDivElement>, edge: WindowResizeEdge) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    const state: WindowResizeState = {
      edge,
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      latestX: event.screenX,
      latestY: event.screenY,
      sentX: event.screenX,
      sentY: event.screenY,
      inFlight: false,
      scheduled: false,
      released: false,
    };
    windowResizeRef.current = state;
    try {
      const result = await bridgeRpc.request.getWindowFrame({});
      if (windowResizeRef.current !== state) return;
      if (result.maximized) {
        windowResizeRef.current = null;
        return;
      }
      state.frame = result;
      state.scaleX = result.width / Math.max(1, window.innerWidth);
      state.scaleY = result.height / Math.max(1, window.innerHeight);
      scheduleWindowResize();
    } catch (error) {
      if (windowResizeRef.current === state) windowResizeRef.current = null;
      setNotice(errorMessage(error));
    }
  };

  const moveWindowResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = windowResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    state.latestX = event.screenX;
    state.latestY = event.screenY;
    scheduleWindowResize();
  };

  const endWindowResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = windowResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    state.latestX = event.screenX;
    state.latestY = event.screenY;
    state.released = true;
    scheduleWindowResize();
    if (state.frame && !state.scheduled && !state.inFlight && state.latestX === state.sentX && state.latestY === state.sentY) {
      windowResizeRef.current = null;
    }
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  };

  const providerConnectParams = (requestedTarget: string, provider: AssistantProvider) => ({
    target: requestedTarget,
    provider,
  });

  const connectProvider = (requestedTarget: string, provider: AssistantProvider) =>
    bridgeRpc.request.connect(providerConnectParams(requestedTarget, provider));

  const loadAdditionalProviderThreads = (requestedTarget: string, selectedProvider: AssistantProvider) => {
    for (const provider of ASSISTANT_PROVIDERS.map((item) => item.id).filter((id) => id !== selectedProvider)) {
      void connectProvider(requestedTarget, provider).then((result) => {
        setThreads((current) => replaceProviderThreads(current, result.threads, provider));
        setProviderCatalogs((current) => ({ ...current, [provider]: { models: result.models, warning: result.modelWarning ?? "" } }));
      }).catch(() => undefined);
    }
  };

  const refresh = async () => {
    if (!connectedTarget) return;
    try {
      const results = await Promise.all(ASSISTANT_PROVIDERS.map(async ({ id: provider }) => {
        try {
          return { provider, result: await connectProvider(connectedTarget, provider) };
        } catch {
          return null;
        }
      }));
      const available = results.filter((item): item is NonNullable<typeof item> => item !== null);
      if (!available.length) throw new Error("어떤 프로바이더에서도 세션 목록을 불러오지 못했습니다.");
      for (const item of available) {
        setThreads((current) => replaceProviderThreads(current, item.result.threads, item.provider));
        setProviderCatalogs((current) => ({ ...current, [item.provider]: { models: item.result.models, warning: item.result.modelWarning ?? "" } }));
      }
      const total = available.reduce((count, item) => count + item.result.threads.length, 0);
      setNotice(`전체 프로바이더에서 세션 목록을 새로 고쳤습니다 · ${total}개`);
    } catch (error) {
      setNotice(errorMessage(error));
      if (!threads.length) setConnectionState("disconnected");
    }
  };

  const openNewSessionDialog = (mode: "workspace" | "session" = "workspace", initialPath = "") => {
    setNewSessionDialogMode(mode);
    setNewSessionPath(initialPath);
    setNewSessionName("");
    setNewKiroPolicyPresets([]);
    setNewSessionError("");
    setNewSessionDialogOpen(true);
  };

  const chooseWorkspaceFolder = async () => {
    if (!isLinuxDesktop || !isDaemonClient || choosingWorkspaceFolder) return;
    setChoosingWorkspaceFolder(true);
    setNewSessionError("");
    try {
      const result = await bridgeRpc.request.chooseWorkspaceFolder({
        ...(newSessionPath ? { startingFolder: newSessionPath } : {}),
      });
      if (result.path) setNewSessionPath(result.path);
    } catch (error) {
      setNewSessionError(errorMessage(error));
    } finally {
      setChoosingWorkspaceFolder(false);
    }
  };

  const openRenameSessionDialog = (thread: RemoteThread) => {
    setRenameDialog({ threadId: thread.id, provider: thread.provider, title: thread.title });
    setRenameSessionName(thread.title);
    setRenameSessionError("");
  };

  const openDeleteSessionDialog = (thread: RemoteThread) => {
    setDeleteDialog(thread);
    setDeleteSessionError("");
  };

  const saveSessionName = async () => {
    if (!renameDialog || renamingSession) return;
    const name = renameSessionName.trim();
    if (!name) {
      setRenameSessionError("세션 이름을 입력하세요.");
      return;
    }
    if (name.length > 120) {
      setRenameSessionError("세션 이름은 120자 이하여야 합니다.");
      return;
    }
    if (name === renameDialog.title) {
      setRenameDialog(null);
      return;
    }
    if (!connectedTarget) return;
    setRenamingSession(true);
    setRenameSessionError("");
    try {
      await bridgeRpc.request.renameThread({ target: connectedTarget, threadId: renameDialog.threadId, name, provider: renameDialog.provider });
      setThreads((current) => current.map((thread) => thread.provider === renameDialog.provider && thread.id === renameDialog.threadId ? { ...thread, title: name } : thread));
      const viewKey = threadViewKey(connectedTarget, renameDialog.provider, renameDialog.threadId);
      const view = threadViews.current.get(viewKey);
      if (view) threadViews.current.set(viewKey, { ...view, title: name });
      if (threadProvider === renameDialog.provider && activeThreadId === renameDialog.threadId) setActiveTitle(name);
      setRenameDialog(null);
      setNotice("세션 이름을 변경했습니다.");
    } catch (error) {
      setRenameSessionError(errorMessage(error));
    } finally {
      setRenamingSession(false);
    }
  };

  const deleteSession = async () => {
    if (!deleteDialog || deletingSession || !connectedTarget) return;
    const thread = deleteDialog;
    const target = connectedTarget;
    const key = runningThreadKey(target, thread.provider, thread.id);
    if (runningThreads.current.has(key)) {
      setDeleteSessionError("작업 중인 세션은 먼저 작업을 중지한 뒤 삭제할 수 있습니다.");
      return;
    }
    const deletesActiveThread = threadProvider === thread.provider &&
      (activeThreadId === thread.id || chatRootThreadId === thread.id);
    setDeletingSession(true);
    setDeleteSessionError("");
    try {
      await bridgeRpc.request.deleteThread({ target, threadId: thread.id, provider: thread.provider });
      const viewKey = threadViewKey(target, thread.provider, thread.id);
      threadViews.current.delete(viewKey);
      draftsByThread.current.delete(viewKey);
      imageAttachmentsByThread.current.delete(viewKey);
      runningThreads.current.delete(key);
      runningTurnIds.current.delete(key);
      observedTurnStarts.current.delete(key);
      interruptedTurns.current.delete(key);
      for (const deltaKey of assistantDeltaBuffer.current.keys()) {
        if (deltaKey.startsWith(`${target}\0${thread.provider}\0${thread.id}\0`)) assistantDeltaBuffer.current.delete(deltaKey);
      }
      setThreads((current) => current.filter((item) => item.provider !== thread.provider || item.id !== thread.id));
      setSideChats((current) => current.filter((chat) => chat.target !== target || chat.provider !== thread.provider || (chat.threadId !== thread.id && chat.rootThreadId !== thread.id)));
      if (renameDialog?.provider === thread.provider && renameDialog.threadId === thread.id) setRenameDialog(null);
      if (deletesActiveThread) {
        slashSkillRefreshSequence.current += 1;
        activeThreadContext.current = { target: "", threadId: "", provider: thread.provider };
        setActiveThreadId("");
        setActiveThreadProvider(null);
        setActiveSideChatId("");
        setMobileSidebarOpen(false);
        setFilePanelOpen(false);
        setActiveTitle("");
        setActiveCwd("");
        setWorkspaceFileOpenRequest(null);
        setCurrentModel("");
        setCurrentEffort(null);
        setCurrentPermissionProfile(null);
        setEntries([]);
        setSkills([]);
        setSkillWarnings([]);
        setSlashCommands([]);
        setSelectedSkill(null);
        setDraft("");
        setActiveTab("chat");
        setBusy(false);
        setActiveTurnId("");
        setStoppingTurn(false);
        setBusySince(null);
        setModelSettingsDialogOpen(false);
        turnInProgress.current = false;
      }
      setDeleteDialog(null);
      setNotice(`“${thread.title}” 세션을 삭제했습니다.`);
    } catch (error) {
      setDeleteSessionError(errorMessage(error));
    } finally {
      setDeletingSession(false);
    }
  };

  const createSessionInWorkspace = async (cwd: string, requestedName = "") => {
    const workspacePath = cwd.trim();
    const sessionName = requestedName.trim();
    if (!connectedTarget || !workspacePath || creatingSession || openingThread) return;
    if (sessionName.length > 120) {
      setNewSessionError("세션 이름은 120자 이하여야 합니다.");
      return;
    }
    cacheActiveThreadView();
    setCreatingSession(true);
    setNotice(`워크스페이스에서 새 ${assistantProviderName} 세션을 만드는 중…`);
    try {
      const provider = assistantProvider;
      const result = await bridgeRpc.request.createThread({
        target: connectedTarget,
        cwd: workspacePath,
        provider,
        ...(sessionName && provider === "kiro" ? { name: sessionName } : {}),
        ...(provider === "kiro" && newKiroPolicyPresets.length ? { permissionPresets: newKiroPolicyPresets } : {}),
      });
      if ((provider === "opencode" || provider === "kiro") && result.models) {
        setProviderCatalogs((current) => ({ ...current, [provider]: { models: result.models!, warning: result.modelWarning ?? "" } }));
      }
      let title = result.title;
      let renameWarning = "";
      if (sessionName && provider !== "kiro") {
        try {
          await bridgeRpc.request.renameThread({ target: connectedTarget, threadId: result.threadId, name: sessionName, provider });
          title = sessionName;
        } catch (error) {
          renameWarning = `세션은 만들었지만 이름을 지정하지 못했습니다: ${errorMessage(error)}`;
        }
      }
      flushAssistantDeltas();
      setThreads((current) => upsertProviderThreads(current, [{ ...result.thread, provider, title }], provider));
      const view: ThreadView = {
        target: connectedTarget,
        threadId: result.threadId,
        provider,
        title,
        cwd: result.cwd,
        model: result.model,
        effort: result.reasoningEffort,
        permissionProfile: result.permissionProfile,
        modes: result.modes ?? [],
        currentModeId: result.currentModeId ?? null,
        entries: result.entries,
        skills: result.skills,
        skillWarnings: result.skillWarnings,
      };
      activateThreadView(view);
      setDraft("");
      setMobileSidebarOpen(false);
      turnInProgress.current = false;
      setBusy(false);
      setBusySince(null);
      setApproval(null);
      setNewSessionDialogOpen(false);
      setNewSessionName("");
      setNewSessionError("");
      setNotice(renameWarning || "새 세션을 만들었습니다. 첫 메시지를 입력하세요.");
    } catch (error) {
      const message = errorMessage(error);
      setNewSessionError(message);
      setNotice(message);
    } finally {
      setCreatingSession(false);
    }
  };

  const openThread = async (requestedTarget: string, thread: RemoteThread, sideChatId = "") => {
    if (thread.provider !== assistantProvider || connectedProvider !== thread.provider) {
      const connected = await connect(undefined, requestedTarget, thread.provider);
      if (!connected) return;
    } else {
      cacheActiveThreadView();
    }
    setOpeningThread(true);
    setNotice(`${providerDisplayName(thread.provider)} 대화 기록을 여는 중…`);
    try {
      const result = await bridgeRpc.request.openThread({ target: requestedTarget, threadId: thread.id, provider: thread.provider });
      if ((thread.provider === "opencode" || thread.provider === "kiro") && result.models) {
        setProviderCatalogs((current) => ({ ...current, [thread.provider]: { models: result.models!, warning: result.modelWarning ?? "" } }));
      }
      flushAssistantDeltas();
      const view: ThreadView = {
        target: requestedTarget,
        threadId: result.threadId,
        provider: thread.provider,
        title: result.title,
        cwd: result.cwd,
        model: result.model,
        effort: result.reasoningEffort,
        permissionProfile: result.permissionProfile,
        modes: result.modes ?? [],
        currentModeId: result.currentModeId ?? null,
        entries: result.entries,
        skills: result.skills,
        skillWarnings: result.skillWarnings,
      };
      activateThreadView(view, sideChatId);
      setMobileSidebarOpen(false);
    } catch (error) {
      const message = errorMessage(error);
      setNotice(/already has an active writer/i.test(message)
        ? `이 세션은 다른 ${providerDisplayName(thread.provider)} 클라이언트에서 사용 중입니다. 기존 클라이언트에서 세션을 닫은 뒤 다시 여세요.`
        : message);
    } finally {
      setOpeningThread(false);
    }
  };

  const forkCompletedResponse = async (entry: TranscriptEntry) => {
    if (!connectedTarget || !activeThreadId || entry.role !== "assistant" || entry.status === "inProgress" || busy || openingThread || forkingEntryId) return;
    const providerMessageId = entry.providerMessageId ?? entry.id;
    flushAssistantDeltas();
    cacheActiveThreadView();
    setForkingEntryId(entry.id);
    setNotice("선택한 AI 응답까지 영구 포크 세션을 만드는 중…");
    let forkedThreadId = "";
    try {
      const forkName = `${activeTitle || "대화"} · 포크`.slice(0, 120);
      const forked = await bridgeRpc.request.forkThread({
        target: connectedTarget,
        threadId: activeThreadId,
        provider: threadProvider,
        name: forkName,
        ...(entry.turnId ? { turnId: entry.turnId } : {}),
        ...(providerMessageId ? { messageId: providerMessageId } : {}),
      });
      forkedThreadId = forked.threadId;
      const forkedThread: RemoteThread = { ...forked, id: forked.threadId, provider: threadProvider, preview: entry.text.slice(0, 240) };
      setThreads((current) => upsertProviderThreads(current, [forkedThread], threadProvider));
      const opened = await bridgeRpc.request.openThread({ target: connectedTarget, threadId: forked.threadId, provider: threadProvider });
      if ((threadProvider === "opencode" || threadProvider === "kiro") && opened.models) {
        setProviderCatalogs((current) => ({ ...current, [threadProvider]: { models: opened.models!, warning: opened.modelWarning ?? "" } }));
      }
      const view: ThreadView = {
        target: connectedTarget,
        threadId: opened.threadId,
        provider: threadProvider,
        title: opened.title,
        cwd: opened.cwd,
        model: opened.model,
        effort: opened.reasoningEffort,
        permissionProfile: opened.permissionProfile,
        modes: opened.modes ?? [],
        currentModeId: opened.currentModeId ?? null,
        entries: opened.entries,
        skills: opened.skills,
        skillWarnings: opened.skillWarnings,
      };
      threadViews.current.set(threadViewKey(connectedTarget, threadProvider, opened.threadId), view);
      setThreads((current) => upsertProviderThreads(current, [{ ...forkedThread, title: opened.title, cwd: opened.cwd }], threadProvider));
      const rootThreadId = activeSideChat?.rootThreadId ?? activeThreadId;
      const siblingCount = sideChats.filter((chat) => chat.target === connectedTarget && chat.provider === threadProvider && chat.rootThreadId === rootThreadId).length;
      const forkTab: SideChatTab = {
        target: connectedTarget,
        threadId: opened.threadId,
        provider: threadProvider,
        parentThreadId: activeThreadId,
        rootThreadId,
        label: `포크 ${siblingCount + 1}`,
        persistent: true,
      };
      setSideChats((current) => [...current, forkTab]);
      activateThreadView(view, opened.threadId);
      setActiveTab("chat");
      setMobileSidebarOpen(false);
      setNotice("선택한 AI 응답까지 영구 포크 세션을 만들었습니다.");
    } catch (error) {
      setNotice(forkedThreadId
        ? `포크 세션은 저장됐지만 대화를 열지 못했습니다: ${errorMessage(error)}`
        : errorMessage(error));
    } finally {
      setForkingEntryId("");
    }
  };

  const createSideChat = async (initialPrompt = "") => {
    if (!connectedTarget || !activeThreadId || openingThread || creatingSideChat) return;
    flushAssistantDeltas();
    cacheActiveThreadView(!initialPrompt.trim());
    const rootThreadId = activeSideChat?.rootThreadId ?? activeThreadId;
    const sourceThreadId = rootThreadId;
    const sourceView = threadViews.current.get(threadViewKey(connectedTarget, threadProvider, sourceThreadId));
    if (!sourceView) {
      setNotice("현재 대화 기록을 보관하지 못했습니다. 세션을 다시 연 뒤 시도하세요.");
      return;
    }
    setCreatingSideChat(true);
    setNotice(threadProvider === "kiro" ? "Kiro 원본 대화의 마지막 응답에서 새 세션을 만드는 중…" : "원본 대화 맥락에서 임시 사이드 대화를 여는 중…");
    try {
      const result = await bridgeRpc.request.forkSideThread({ target: connectedTarget, threadId: sourceThreadId, provider: threadProvider });
      if ((threadProvider === "opencode" || threadProvider === "kiro") && result.models) {
        setProviderCatalogs((current) => ({ ...current, [threadProvider]: { models: result.models!, warning: result.modelWarning ?? "" } }));
      }
      const siblingCount = sideChats.filter((chat) => chat.target === connectedTarget && chat.provider === threadProvider && chat.rootThreadId === rootThreadId).length;
      const view: ThreadView = {
        target: connectedTarget,
        threadId: result.threadId,
        provider: threadProvider,
        title: result.title,
        cwd: result.cwd,
        model: result.model,
        effort: result.reasoningEffort,
        permissionProfile: result.permissionProfile,
        modes: result.modes ?? [],
        currentModeId: result.currentModeId ?? null,
        entries: [...sourceView.entries],
        skills: result.skills,
        skillWarnings: result.skillWarnings,
      };
      const sideTab: SideChatTab = {
        target: connectedTarget,
        threadId: result.threadId,
        provider: threadProvider,
        parentThreadId: sourceThreadId,
        rootThreadId,
        label: `사이드 ${siblingCount + 1}`,
        ...(threadProvider === "kiro" ? { persistent: true } : {}),
      };
      threadViews.current.set(threadViewKey(connectedTarget, threadProvider, result.threadId), view);
      setSideChats((current) => [...current, sideTab]);
      activateThreadView(view, result.threadId);
      setDraft("");
      if (initialPrompt.trim()) {
        const text = initialPrompt.trim();
        const startedAt = Date.now();
        const threadKey = runningThreadKey(connectedTarget, threadProvider, result.threadId);
        runningThreads.current.set(threadKey, startedAt);
        runningTurnIds.current.delete(threadKey);
        updateThreadEntries(connectedTarget, threadProvider, result.threadId, (current) => [...current, { id: `local-${startedAt}`, role: "user", text }]);
        turnInProgress.current = false;
        setBusy(true);
        setActiveTurnId("");
        setStoppingTurn(false);
        setBusySince(startedAt);
        setNotice("");
        try {
          const started = await bridgeRpc.request.sendPrompt({ target: connectedTarget, threadId: result.threadId, text, provider: threadProvider });
          if (started.turnId) {
            runningTurnIds.current.set(threadKey, started.turnId);
            if (activeThreadContext.current.target === connectedTarget && activeThreadContext.current.provider === threadProvider && activeThreadContext.current.threadId === result.threadId) {
              setActiveTurnId(started.turnId);
            }
          }
        } catch (error) {
          const stillSelected = activeThreadContext.current.target === connectedTarget && activeThreadContext.current.provider === threadProvider && activeThreadContext.current.threadId === result.threadId;
          if (!observedTurnStarts.current.has(threadKey)) {
            runningThreads.current.delete(threadKey);
            runningTurnIds.current.delete(threadKey);
            if (stillSelected) {
              setBusy(false);
              setActiveTurnId("");
              setBusySince(null);
            }
          }
          if (stillSelected) setNotice(errorMessage(error));
        }
      } else {
        setNotice("원본 맥락을 이어받은 독립 사이드 대화를 열었습니다.");
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setCreatingSideChat(false);
    }
  };

  const switchChatTab = (threadId: string, sideChatId = "") => {
    if (threadId === activeThreadId) {
      setActiveSideChatId(sideChatId);
      setActiveTab("chat");
      return;
    }
    flushAssistantDeltas();
    cacheActiveThreadView();
    const view = threadViews.current.get(threadViewKey(connectedTarget, threadProvider, threadId));
    if (view) {
      activateThreadView(view, sideChatId);
      return;
    }
    const thread = threads.find((item) => item.provider === threadProvider && item.id === threadId);
    if (thread) void openThread(connectedTarget, thread, sideChatId);
  };

  const closeSideChat = (chat: SideChatTab) => {
    const wasSelected = threadProvider === chat.provider && activeThreadId === chat.threadId;
    const contentTab = activeTab;
    setSideChats((current) => current.filter((item) => item.target !== chat.target || item.provider !== chat.provider || item.threadId !== chat.threadId));
    if (!wasSelected) return;
    switchChatTab(chat.rootThreadId);
    if (contentTab !== "chat") setActiveTab(contentTab);
  };

  const openTerminalTab = () => {
    if (terminalContext || !connectedTarget || !activeCwd) return;
    setTerminalContext({ target: connectedTarget, cwd: activeCwd });
    setActiveTab("terminal");
    setTabCreateMenuOpen(false);
  };

  const closeTerminalTab = () => {
    setTerminalContext(null);
    if (activeTab === "terminal") setActiveTab("chat");
  };

  const refreshSlashSkills = async () => {
    if (!connectedTarget || !activeThreadId) return;
    const target = connectedTarget;
    const threadId = activeThreadId;
    const provider = threadProvider;
    const cwd = activeCwd;
    const sequence = ++slashSkillRefreshSequence.current;
    setSlashSkillLoading(true);
    try {
      const [skillResult, commandResult] = await Promise.all([
        bridgeRpc.request.listSkills({ target, threadId, cwd, provider }),
        bridgeRpc.request.listCommands({ target, threadId, cwd, provider }),
      ]);
      const stillSelected = activeThreadContext.current.target === target &&
        activeThreadContext.current.threadId === threadId &&
        activeThreadContext.current.provider === provider;
      if (sequence !== slashSkillRefreshSequence.current || !stillSelected) return;
      setSkills(skillResult.skills);
      setSlashCommands(commandResult.commands);
      const warnings = [...skillResult.warnings, ...commandResult.warnings];
      setSkillWarnings(warnings);
      const key = threadViewKey(target, provider, threadId);
      const view = threadViews.current.get(key);
      if (view) threadViews.current.set(key, { ...view, skills: skillResult.skills, skillWarnings: warnings });
      setSlashSkillIndex(0);
    } catch (error) {
      if (sequence === slashSkillRefreshSequence.current) setSkillWarnings([errorMessage(error)]);
    } finally {
      if (sequence === slashSkillRefreshSequence.current) setSlashSkillLoading(false);
    }
  };

  useEffect(() => {
    if (slashMenuOpen) void refreshSlashSkills();
  }, [slashMenuOpen, connectedTarget, activeThreadId, threadProvider]);

  const chooseSlashSkill = (skill: RemoteSkill) => {
    setSelectedSkill(skill);
    setDraft("");
    setSlashSkillIndex(0);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const chooseSlashCommand = (command: RemoteCommand) => {
    setSelectedSkill(null);
    setDraft(`/${command.name} `);
    setSlashSkillIndex(0);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const chooseSlashMenuItem = (item: SlashMenuItem) => {
    if (item.kind === "skill") chooseSlashSkill(item.skill);
    else chooseSlashCommand(item.command);
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen) {
      if (event.key === "ArrowDown" && visibleSlashItems.length) {
        event.preventDefault();
        setSlashSkillIndex((index) => (index + 1) % visibleSlashItems.length);
        return;
      }
      if (event.key === "ArrowUp" && visibleSlashItems.length) {
        event.preventDefault();
        setSlashSkillIndex((index) => (index + visibleSlashItems.length - 1) % visibleSlashItems.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDraft("");
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const item = visibleSlashItems[slashSkillIndex];
        if (item) chooseSlashMenuItem(item);
        else if (!slashSkillLoading) void sendPrompt();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendPrompt();
    }
  };

  const steerPrompt = async (text: string, skillId?: string) => {
    if (!connectedTarget || !activeThreadId || !busy || steeringPrompt || stoppingTurn) return;
    const promptTarget = connectedTarget;
    const promptThreadId = activeThreadId;
    const promptProvider = threadProvider;
    const promptKey = runningThreadKey(promptTarget, promptProvider, promptThreadId);
    draftsByThread.current.delete(threadViewKey(promptTarget, promptProvider, promptThreadId));
    setDraft("");
    setSteeringPrompt(true);
    setNotice("");
    let turnId = runningTurnIds.current.get(promptKey) ?? (activeThreadContext.current.target === promptTarget && activeThreadContext.current.provider === promptProvider && activeThreadContext.current.threadId === promptThreadId ? activeTurnId : "");
    for (let attempt = 0; !turnId && attempt < 50 && runningThreads.current.has(promptKey); attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      turnId = runningTurnIds.current.get(promptKey) ?? "";
    }
    if (!turnId) {
      const stillSelected = activeThreadContext.current.target === promptTarget && activeThreadContext.current.provider === promptProvider && activeThreadContext.current.threadId === promptThreadId;
      if (stillSelected) setDraft((current) => current.trim() ? current : text);
      else draftsByThread.current.set(threadViewKey(promptTarget, promptProvider, promptThreadId), text);
      if (stillSelected) setNotice(`${threadProviderName} 작업 시작을 확인하는 중입니다. 잠시 뒤 다시 보내 주세요.`);
      setSteeringPrompt(false);
      return;
    }

    try {
      const result = await bridgeRpc.request.steerTurn({ target: promptTarget, threadId: promptThreadId, turnId, text, cwd: activeCwd, ...(skillId ? { skillId } : {}), provider: promptProvider });
      const acceptedTurnId = result.turnId || turnId;
      runningTurnIds.current.set(promptKey, acceptedTurnId);
      const stillSelected = activeThreadContext.current.target === promptTarget && activeThreadContext.current.provider === promptProvider && activeThreadContext.current.threadId === promptThreadId;
      updateThreadEntries(promptTarget, promptProvider, promptThreadId, (current) => [...current, {
        id: `local-steer-${acceptedTurnId}-${Date.now()}`,
        role: "user",
        text,
      }]);
      if (skillId) setSelectedSkill(null);
      if (stillSelected) setNotice(`현재 ${threadProviderName} 작업에 메시지를 전달했습니다. 다음 처리 단계부터 반영됩니다.`);
    } catch (error) {
      const stillSelected = activeThreadContext.current.target === promptTarget && activeThreadContext.current.provider === promptProvider && activeThreadContext.current.threadId === promptThreadId;
      if (stillSelected) setDraft((current) => current.trim() ? current : text);
      else draftsByThread.current.set(threadViewKey(promptTarget, promptProvider, promptThreadId), text);
      if (stillSelected) setNotice(errorMessage(error));
    } finally {
      setSteeringPrompt(false);
    }
  };

  const sendPrompt = async (inputText?: string) => {
    const pendingImages = threadProvider === "kiro" ? imageAttachments : [];
    const text = (inputText ?? draft).trim() || (pendingImages.length ? "첨부한 이미지를 확인해 주세요." : "");
    if (!text || !connectedTarget || !activeThreadId) return;
    if (slashMenuOpen && slashSkillLoading) return;
    const typedCommand = text.match(/^\/([A-Za-z0-9._/-]+)(?:\s+([\s\S]*))?$/);
    let matchedSlashCommand = typedCommand && slashCommands.find((command) => command.name === typedCommand[1]);
    const localCommand = typedCommand && /^(?:help|quit|exit|side|resume|skills)$/i.test(typedCommand[1]);
    if (typedCommand && !matchedSlashCommand && !localCommand) {
      try {
        const result = await bridgeRpc.request.listCommands({ target: connectedTarget, threadId: activeThreadId, cwd: activeCwd, provider: threadProvider });
        matchedSlashCommand = result.commands.find((command) => command.name === typedCommand[1]) ?? null;
        if (activeThreadContext.current.target === connectedTarget && activeThreadContext.current.threadId === activeThreadId && activeThreadContext.current.provider === threadProvider) {
          setSlashCommands(result.commands);
        }
      } catch {
        // An unrecognized slash prefix remains an ordinary provider prompt.
      }
    }
    if (pendingImages.length && typedCommand) {
      setNotice("이미지는 Kiro 일반 메시지에 첨부할 수 있습니다. 먼저 슬래시 명령을 지우세요.");
      return;
    }
    const skillId = matchedSlashCommand ? undefined : selectedSkill?.id;
    if (busy) {
      if (matchedSlashCommand) {
        setNotice("명령은 현재 응답이 끝난 뒤 실행하세요.");
        return;
      }
      if (threadProvider === "opencode" || threadProvider === "kiro") {
        setNotice(threadProvider === "kiro"
          ? "Hive에서 Kiro 응답 중 추가 메시지 전달은 아직 연결하지 않았습니다. 응답을 중지하거나 끝날 때까지 기다려 주세요."
          : "OpenCode는 생성 중인 응답에 메시지를 추가할 수 없습니다. 응답을 중지하거나 끝날 때까지 기다려 주세요.");
        return;
      }
      await steerPrompt(text, skillId);
      return;
    }
    if (text === "/help") {
      setNotice("Hive 명령: /side [질문], /skills [검색어], /skill:<이름> [요청], /resume <세션 ID>, /quit. 그 밖의 입력은 현재 세션에 전달됩니다.");
      setDraft("");
      return;
    }
    if (text === "/quit" || text === "/exit") {
      setDraft("");
      await disconnect();
      return;
    }
    const sideCommand = text.match(/^\/side(?:\s+([\s\S]*))?$/i);
    if (sideCommand) {
      draftsByThread.current.delete(threadViewKey(connectedTarget, threadProvider, activeThreadId));
      setDraft("");
      await createSideChat(sideCommand[1] ?? "");
      return;
    }
    const resumeCommand = text.match(/^\/resume(?:\s+([A-Za-z0-9_-]{1,128}))?$/i);
    if (resumeCommand) {
      const requestedId = resumeCommand[1];
      const matches = requestedId ? threads.filter((thread) => thread.id === requestedId || thread.id.startsWith(requestedId)) : [];
      const match = matches.find((thread) => thread.provider === threadProvider) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!match) setNotice(requestedId ? "해당 ID와 일치하는 세션이 없습니다." : "왼쪽 세션 목록에서 이어갈 대화를 선택하거나 /resume <세션 ID>를 입력하세요.");
      else await openThread(connectedTarget, match);
      setDraft("");
      return;
    }
    if (/^\/skills(?:\s|$)/i.test(text)) {
      setFilter(text.replace(/^\/skills\s*/i, ""));
      setActivePage("skills");
      setDraft("");
      return;
    }
    if ((threadProvider === "opencode" || threadProvider === "kiro") && !currentModel.trim()) {
      setNotice(models.some((model) => !model.hidden)
        ? `${threadProviderName} 모델을 선택한 뒤 메시지를 보내세요.`
        : modelWarning || `${threadProviderName}에서 선택할 수 있는 모델이 없습니다.`);
      setModelSettingsDialogOpen(true);
      return;
    }
    if (matchedSlashCommand && typedCommand) {
      if (threadProvider === "codex" || threadProvider === "opencode" || threadProvider === "kiro") {
        setDraft("");
        setNotice("");
        try {
          const result = await bridgeRpc.request.runCommand({
            target: connectedTarget,
            threadId: activeThreadId,
            command: matchedSlashCommand.name,
            arguments: typedCommand[2] ?? "",
            cwd: activeCwd,
            provider: threadProvider,
          });
          if (result.thread) {
            setThreads((current) => upsertProviderThreads(current, [result.thread!], threadProvider));
            await openThread(connectedTarget, result.thread);
          }
          setNotice(result.message ?? `/${matchedSlashCommand.name} 명령을 실행했습니다.`);
        } catch (error) {
          setDraft(text);
          setNotice(errorMessage(error));
        }
        return;
      }
    }
    const promptTarget = connectedTarget;
    const promptThreadId = activeThreadId;
    const promptProvider = threadProvider;
    const promptKey = runningThreadKey(promptTarget, promptProvider, promptThreadId);
    const promptImages: PromptImageAttachment[] = pendingImages.map(({ id: _id, ...image }) => image);
    const displayText = promptImages.length
      ? `${text}\n\n[이미지 첨부: ${promptImages.map((image) => image.name).join(", ")}]`
      : text;
    const startedAt = Date.now();
    runningThreads.current.set(promptKey, startedAt);
    runningTurnIds.current.delete(promptKey);
    updateThreadEntries(promptTarget, promptProvider, promptThreadId, (current) => [...current, { id: `local-${startedAt}`, role: "user", text: displayText, ...(promptImages.length ? { images: promptImages } : {}) }]);
    const imageKey = threadViewKey(promptTarget, promptProvider, promptThreadId);
    draftsByThread.current.delete(imageKey);
    setDraft("");
    turnInProgress.current = false;
    setBusy(true);
    setActiveTurnId("");
    setStoppingTurn(false);
    setSteeringPrompt(false);
    setBusySince(startedAt);
    setNotice("");
    try {
      const started = await bridgeRpc.request.sendPrompt({ target: promptTarget, threadId: promptThreadId, text, cwd: activeCwd, ...(skillId ? { skillId } : {}), ...(promptImages.length ? { images: promptImages } : {}), provider: promptProvider });
      if (promptImages.length) {
        imageAttachmentsByThread.current.delete(imageKey);
        if (activeThreadContext.current.target === promptTarget && activeThreadContext.current.provider === promptProvider && activeThreadContext.current.threadId === promptThreadId) setImageAttachments([]);
      }
      if (skillId) setSelectedSkill(null);
      if (started.turnId) {
        runningTurnIds.current.set(promptKey, started.turnId);
        if (activeThreadContext.current.target === promptTarget && activeThreadContext.current.provider === promptProvider && activeThreadContext.current.threadId === promptThreadId) {
          setActiveTurnId(started.turnId);
        }
      }
    } catch (error) {
      const observed = observedTurnStarts.current.has(promptKey);
      const stillSelected = activeThreadContext.current.target === promptTarget && activeThreadContext.current.provider === promptProvider && activeThreadContext.current.threadId === promptThreadId;
      if (observed && promptImages.length) {
        imageAttachmentsByThread.current.delete(imageKey);
        if (stillSelected) setImageAttachments([]);
      }
      if (!observed) {
        runningThreads.current.delete(promptKey);
        runningTurnIds.current.delete(promptKey);
      }
      if (stillSelected) {
        if (observed) {
          setNotice(`${threadProviderName}가 응답 중입니다. 시작 확인이 지연됐지만 응답을 계속 받고 있습니다.`);
        } else {
          turnInProgress.current = false;
          setBusy(false);
          setActiveTurnId("");
          setBusySince(null);
          setNotice(errorMessage(error));
        }
      }
    }
  };

  const stopTurn = async () => {
    if (!connectedTarget || !activeThreadId || !busy || stoppingTurn) return;
    const target = connectedTarget;
    const threadId = activeThreadId;
    const provider = threadProvider;
    const threadKey = runningThreadKey(target, provider, threadId);
    let turnId = runningTurnIds.current.get(threadKey) ?? activeTurnId;
    for (let attempt = 0; !turnId && attempt < 50 && runningThreads.current.has(threadKey); attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      turnId = runningTurnIds.current.get(threadKey) ?? "";
    }
    if (!turnId) {
      setNotice(`${threadProviderName} 작업 시작을 확인하는 중입니다. 잠시 뒤 다시 눌러 주세요.`);
      return;
    }

    interruptedTurns.current.add(threadKey);
    setStoppingTurn(true);
    setNotice(`${threadProviderName} 작업을 중지하는 중…`);
    try {
      await bridgeRpc.request.interruptTurn({ target, threadId, turnId, provider });
      if (activeThreadContext.current.target === target && activeThreadContext.current.provider === provider && activeThreadContext.current.threadId === threadId) {
        setNotice(`${threadProviderName} 작업 중지 요청을 보냈습니다.`);
      }
    } catch (error) {
      interruptedTurns.current.delete(threadKey);
      if (activeThreadContext.current.target === target && activeThreadContext.current.provider === provider && activeThreadContext.current.threadId === threadId) {
        setStoppingTurn(false);
        setNotice(errorMessage(error));
      }
    }
  };

  const answerApproval = async (decision: "accept" | "acceptForSession" | "decline") => {
    if (!approval) return;
    try {
      await bridgeRpc.request.answerApproval({ target: connectedTarget, requestId: approval.requestId, decision, provider: approval.provider });
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setApproval(null);
    }
  };

  const updateSettings = async (change: { model?: string; effort?: string; permissionProfile?: string; modeId?: string }) => {
    if (!connectedTarget || !activeThreadId) return;
    setUpdatingSettings(true);
    setNotice(`${threadProviderName} 설정을 변경하는 중…`);
    try {
      const result = await bridgeRpc.request.updateThreadSettings({
        target: connectedTarget,
        threadId: activeThreadId,
        provider: threadProvider,
        ...change,
      });
      const viewKey = threadViewKey(connectedTarget, threadProvider, activeThreadId);
      const view = threadViews.current.get(viewKey);
      if (view) {
        threadViews.current.set(viewKey, {
          ...view,
          model: result.model ?? view.model,
          effort: result.effort ?? view.effort,
          permissionProfile: result.permissionProfile ?? view.permissionProfile,
          currentModeId: result.currentModeId ?? view.currentModeId,
        });
      }
      if (result.model) setCurrentModel(result.model);
      if (result.effort) setCurrentEffort(result.effort);
      if (result.permissionProfile) setCurrentPermissionProfile(result.permissionProfile);
      if (result.currentModeId) setCurrentModeId(result.currentModeId);
      if (result.supportedReasoningEfforts) {
        const selectedModelId = result.model ?? currentModel;
        setProviderCatalogs((current) => {
          const catalog = current[threadProvider];
          if (!catalog) return current;
          return { ...current, [threadProvider]: { ...catalog, models: catalog.models.map((model) => model.model === selectedModelId ? { ...model, supportedReasoningEfforts: result.supportedReasoningEfforts! } : model) } };
        });
      }
      const modelName = change.model ? models.find((model) => model.model === change.model)?.displayName ?? change.model : undefined;
      setNotice(change.model
        ? `${modelName} 모델로 변경했습니다. 다음 턴부터 적용됩니다.`
        : change.permissionProfile
          ? `권한을 ${permissionPresetLabel(change.permissionProfile)}로 변경했습니다. 다음 턴부터 적용됩니다.`
          : change.modeId
            ? `Kiro 에이전트 모드를 ${currentModes.find((mode) => mode.id === change.modeId)?.name ?? change.modeId}(으)로 바꿨습니다.`
          : `Thinking을 ${effortLabel(change.effort ?? "")}로 변경했습니다. 다음 턴부터 적용됩니다.`);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setUpdatingSettings(false);
    }
  };

  const changeModel = (modelId: string) => {
    const model = models.find((candidate) => candidate.model === modelId);
    if (!model) return;
    const effort = currentEffort && model.supportedReasoningEfforts.some((option) => option.reasoningEffort === currentEffort)
      ? currentEffort
      : model.defaultReasoningEffort;
    void updateSettings({ model: model.model, ...(effort ? { effort } : {}) });
  };

  const disconnect = async () => {
    if (connectedTarget) {
      try { await disconnectProviderSessions(connectedTarget); }
      catch (error) { setNotice(errorMessage(error)); }
    }
    setConnectionState("disconnected");
    setConnectedTarget("");
    setConnectedProvider(assistantProvider);
    setActiveThreadId("");
    slashSkillRefreshSequence.current += 1;
    setSelectedSkill(null);
    setSlashSkillLoading(false);
    setActiveThreadProvider(null);
    setActiveSideChatId("");
    setSideChats([]);
    setWorkspaceFileOpenRequest(null);
    setTerminalContext(null);
    setActiveTab("chat");
    threadViews.current.clear();
    draftsByThread.current.clear();
    assistantDeltaBuffer.current.clear();
    runningThreads.current.clear();
    runningTurnIds.current.clear();
    observedTurnStarts.current.clear();
    interruptedTurns.current.clear();
    activeThreadContext.current = { target: "", threadId: "", provider: assistantProvider };
    turnInProgress.current = false;
    setBusy(false);
    setActiveTurnId("");
    setStoppingTurn(false);
    setBusySince(null);
    setCurrentModel("");
    setCurrentEffort(null);
    setThreads([]);
    setProviderCatalogs({});
    setEntries([]);
    setSkills([]);
    setSlashCommands([]);
    openSettings("connection");
    setNotice("호스트 연결을 종료했습니다.");
  };

  const toggleProject = (key: string) => setCollapsedProjects((current) =>
    current.includes(key) ? current.filter((project) => project !== key) : [...current, key],
  );

  const toggleFilePanel = () => {
    const nextOpen = !filePanelOpen;
    if (isMobileApp && !isWideLayout && nextOpen) setMobileSidebarOpen(false);
    setFilePanelInitialized(true);
    setFilePanelOpen(nextOpen);
  };

  const toggleSidebar = () => {
    if (isMobileApp && !isWideLayout) {
      const nextOpen = !mobileSidebarOpen;
      if (nextOpen) setFilePanelOpen(false);
      setMobileSidebarOpen(nextOpen);
      return;
    }
    setDesktopSidebarCollapsed((collapsed) => !collapsed);
  };

  const closeWorkspaceFileTab = (id: string) => {
    const index = workspaceFileTabs.findIndex((tab) => tab.id === id);
    const remaining = workspaceFileTabs.filter((tab) => tab.id !== id);
    const nextTab = remaining[index] ?? remaining[index - 1];
    setWorkspaceFileTabs(remaining);
    if (activeTab === `file:${id}`) {
      setActiveTab(nextTab ? `file:${nextTab.id}` : terminalContext ? "terminal" : "chat");
    }
  };
  const sidebarA11yHidden = (desktopSidebarCollapsed && (!isMobileApp || isWideLayout)) || (isMobileApp && !isWideLayout && !mobileSidebarOpen);
  const narrowMobileDrawerOpen = isMobileApp && !isWideLayout && (mobileSidebarOpen || (activePage === "sessions" && filePanelOpen));
  const settingsPageClass = activePage === "settings" ? `settings-section-${settingsSection}` : "";

  return (
    <div ref={appShellRef} className={`app-shell page-${activePage} ${settingsPageClass} ${isMobileApp ? "mobile-app" : ""} ${isLinuxDesktop ? "linux-desktop" : ""} ${desktopSidebarCollapsed ? "desktop-sidebar-collapsed" : ""}`}>
      {isMobileApp && !isWideLayout && <button className={`mobile-drawer-backdrop ${narrowMobileDrawerOpen ? "is-open" : ""}`} onClick={() => { setMobileSidebarOpen(false); setFilePanelOpen(false); }} aria-label="패널 닫기" aria-hidden={!narrowMobileDrawerOpen} inert={!narrowMobileDrawerOpen} />}
      <aside ref={sidebarRef} id="workspace-sidebar" className={`sidebar ${activePage === "sessions" ? "sessions-sidebar" : activePage === "skills" ? "skills-sidebar" : "settings-sidebar"} ${mobileSidebarOpen ? "mobile-open" : ""}`} aria-hidden={sidebarA11yHidden} inert={sidebarA11yHidden}>
        <div className="brand-row electrobun-webkit-app-region-drag">
          {sidebarGtkLeftDecorations.length > 0 && <div className="window-controls window-controls-left sidebar-window-controls electrobun-webkit-app-region-no-drag" style={gtkControlStyle} aria-label="왼쪽 창 제어">
            {renderGtkDecorations(sidebarGtkLeftDecorations, "left")}
          </div>}
          <div className="brand-row-actions">
            <button className="icon-button sidebar-action electrobun-webkit-app-region-no-drag" type="button" title="새 워크스페이스" aria-label="새 워크스페이스" onClick={() => openNewSessionDialog("workspace")} disabled={connectionState !== "connected" || creatingSession || openingThread}><Icon name="plus" /></button>
            {sidebarGtkRightDecorations.length > 0 && <div className="window-controls window-controls-right sidebar-window-controls electrobun-webkit-app-region-no-drag" style={gtkControlStyle} aria-label="오른쪽 창 제어">
              {renderGtkDecorations(sidebarGtkRightDecorations, "right")}
            </div>}
          </div>
        </div>
        <nav className="app-nav" aria-label="주 메뉴">
          <button className={activePage === "sessions" ? "app-nav-item active" : "app-nav-item"} onClick={() => { setActivePage("sessions"); setMobileSidebarOpen(false); }}><Icon name="message" /><span>세션</span></button>
          <button className={activePage === "skills" ? "app-nav-item active" : "app-nav-item"} onClick={() => { setActivePage("skills"); setMobileSidebarOpen(false); }}><Icon name="sparkles" /><span>스킬</span><small>{skills.length}</small></button>
          <button className={activePage === "settings" ? "app-nav-item active" : "app-nav-item"} onClick={() => openSettings()}><Icon name="settings" /><span>설정</span></button>
        </nav>

        {activePage === "sessions" && <>
        <div className="sidebar-section-heading"><span>WORKSPACES</span><div className="sidebar-section-actions"><button className="icon-button" title="새 워크스페이스" aria-label="새 워크스페이스" onClick={() => openNewSessionDialog("workspace")} disabled={connectionState !== "connected" || creatingSession}><Icon name="plus" /></button><button className="icon-button" title="세션 새로고침" onClick={() => void refresh()} disabled={connectionState !== "connected"}><Icon name="refresh" /></button></div></div>
        <div className="project-list">
          {projects.length ? projects.map((project) => {
            const collapsed = collapsedProjects.includes(project.key);
            return <section className="project-group" key={project.key}>
              <div className="project-heading" title={project.path}>
                <button className="project-heading-toggle" onClick={() => toggleProject(project.key)} aria-label={`${project.name} 세션 ${collapsed ? "펼치기" : "접기"}`}>
                  <Icon name={collapsed ? "chevron-right" : "chevron-down"} /><Icon name="folder" /><b>{project.name}</b><span className="session-count">{project.sessions.length}</span>
                </button>
                <button className="project-new-session" title={`${project.name}에서 새 세션`} aria-label={`${project.name} 워크스페이스에서 새 세션`} onClick={() => openNewSessionDialog("session", project.path)} disabled={!project.path || creatingSession || openingThread}><Icon name="plus" /></button>
              </div>
              {!collapsed && <div className="session-list">{project.sessions.map((thread) => <div key={`${thread.provider}:${thread.id}`} className={`session-row ${thread.provider === threadProvider && thread.id === chatRootThreadId ? "selected" : ""}`}>
                <button className={`session-item ${thread.provider === threadProvider && thread.id === chatRootThreadId ? "selected" : ""}`} onClick={() => void openThread(connectedTarget, thread)}>
                  <span className="session-dot"><Icon name="message" /></span><span className="session-details"><b>{thread.title}</b><small>{providerDisplayName(thread.provider)} · {formatAge(thread.updatedAt)}</small></span>
                </button>
                <div className="session-row-actions">
                  <button className="session-row-action" type="button" title={`이름 수정: ${thread.title}`} aria-label={`세션 이름 수정: ${thread.title}`} onClick={() => openRenameSessionDialog(thread)} disabled={renamingSession || deletingSession || creatingSession}><Icon name="edit" /></button>
                  <button className="session-row-action delete" type="button" title={`세션 삭제: ${thread.title}`} aria-label={`세션 삭제: ${thread.title}`} onClick={() => openDeleteSessionDialog(thread)} disabled={deletingSession || creatingSession}><Icon name="trash" /></button>
                </div>
              </div>)}</div>}
            </section>;
          }) : <div className="sidebar-empty">{connectionState === "connected" ? <><p>세션 목록이 비어 있습니다.</p><button className="toolbar-button subtle" onClick={() => openNewSessionDialog("workspace")} disabled={creatingSession}><Icon name="plus" /> 새 워크스페이스</button></> : isDaemonClient ? `데몬의 ${assistantProviderName}에 연결하면 세션이 표시됩니다.` : `${assistantProviderName} host를 연결하면 세션이 표시됩니다.`}</div>}
        </div>
        </>}
        {activePage === "skills" && <div className="context-sidebar skills-context">
          <div className="context-heading"><span>SKILL CATALOG</span><b>{skills.length.toString().padStart(2, "0")}</b></div>
          <p>현재 {threadProviderName} 호스트와 세션에서 사용할 수 있는 도구입니다.</p>
          <div className="provider-list" aria-label="제공자 필터">
            {providers.map((provider) => <button key={provider} className={skillProvider === provider ? "provider-filter active" : "provider-filter"} onClick={() => setSkillProvider(provider)}><span>{provider === "전체 제공자" ? <Icon name="sparkles" /> : <span className="provider-glyph">{provider.slice(0, 1).toUpperCase()}</span>}{provider}</span><small>{provider === "전체 제공자" ? skills.length : skills.filter((skill) => skill.provider === provider).length}</small></button>)}
          </div>
          <div className="context-sidebar-note"><span className={connectionState === "connected" ? "status-green" : "status-green preview-led"} />{connectionState === "connected" ? "원격 카탈로그 동기화됨" : "호스트 연결 필요"}</div>
        </div>}
        {activePage === "settings" && <div className="context-sidebar settings-context">
          <div className="context-heading"><span>APP SETTINGS</span></div>
          <p>연결 정보와 화면 테마를 관리합니다.</p>
          <nav className="settings-section-nav" aria-label="설정 페이지">
            <button type="button" className={settingsSection === "connection" ? "settings-section-item active" : "settings-section-item"} onClick={() => { setSettingsSection("connection"); setMobileSidebarOpen(false); }}><Icon name="branch" /><span>연결</span>{connectionState === "connected" && <small>연결됨</small>}</button>
            <button type="button" className={settingsSection === "theme" ? "settings-section-item active" : "settings-section-item"} onClick={() => { setSettingsSection("theme"); setMobileSidebarOpen(false); }}><Icon name="sun" /><span>테마</span></button>
          </nav>
        </div>}
      </aside>

      <main className="main-column">
        <header className="topbar electrobun-webkit-app-region-drag" style={gtkTopbarStyle} data-gtk-theme={gtkSettings?.gtk.theme} data-gtk-icon-theme={gtkSettings?.gtk.iconTheme}>
          <div className="topbar-leading">
            {isLinuxDesktop && topbarGtkLeftDecorations.length > 0 && <div className="window-controls window-controls-left electrobun-webkit-app-region-no-drag" style={gtkControlStyle} aria-label="왼쪽 창 제어">
              {renderGtkDecorations(topbarGtkLeftDecorations, "left")}
            </div>}
            <div className="breadcrumbs">
            <button className="desktop-sidebar-toggle-button electrobun-webkit-app-region-no-drag" type="button" onClick={toggleSidebar} aria-label={isMobileApp && !isWideLayout ? mobileSidebarOpen ? "워크스페이스 닫기" : "워크스페이스 열기" : desktopSidebarCollapsed ? "워크스페이스 펼치기" : "워크스페이스 접기"} aria-controls="workspace-sidebar" aria-expanded={isMobileApp && !isWideLayout ? mobileSidebarOpen : !desktopSidebarCollapsed} title={isMobileApp && !isWideLayout ? mobileSidebarOpen ? "워크스페이스 닫기" : "워크스페이스 열기" : desktopSidebarCollapsed ? "워크스페이스 펼치기" : "워크스페이스 접기"}><Icon name="panel-left" /></button>
            <b>{activePage === "sessions" ? activeTitle || "세션" : activePage === "skills" ? "스킬" : activePage === "settings" ? settingsSection === "connection" ? "연결" : "테마" : ""}</b>
            </div>
          </div>
          <div className="topbar-actions electrobun-webkit-app-region-no-drag">
            {activePage === "sessions" && <button className={`icon-button file-panel-toggle ${filePanelOpen ? "active" : ""}`} type="button" aria-label={filePanelOpen ? "파일 패널 닫기" : "파일 패널 열기"} aria-pressed={filePanelOpen} title={filePanelOpen ? "파일 패널 닫기" : "파일 패널 열기"} onClick={toggleFilePanel}><Icon name="panel-right" /></button>}
            {isLinuxDesktop && topbarGtkRightDecorations.length > 0 && <div className="window-controls window-controls-right" style={gtkControlStyle} aria-label="오른쪽 창 제어">
              {renderGtkDecorations(topbarGtkRightDecorations, "right")}
            </div>}
          </div>
        </header>

        {activePage === "sessions" && <>
        <div className="content-row">
          <section className="conversation-pane">
            <div className="side-chat-tabs" role="tablist" aria-label="작업 탭">
              <button role="tab" aria-selected={activeTab === "chat" && !activeSideChatId} className={activeTab === "chat" && !activeSideChatId ? "active" : ""} onClick={() => activeThreadId ? switchChatTab(chatRootThreadId) : setActiveTab("chat")} title="메인 대화">
                <Icon name="message" /><span>{activeThreadId ? mainThreadLabel : "대화"}</span>
              </button>
              {visibleSideChats.map((chat) => {
                const isActive = activeTab === "chat" && threadProvider === chat.provider && activeThreadId === chat.threadId;
                return <div className={`workspace-file-tab conversation-tab ${isActive ? "active" : ""}`} key={`${chat.provider}:${chat.threadId}`} role="presentation">
                  <button className="workspace-file-tab-select" role="tab" aria-selected={isActive} onClick={() => switchChatTab(chat.threadId, chat.threadId)} title={chat.persistent ? "프로바이더에 저장된 영구 포크 대화" : "앱 연결이 끝나면 사라지는 임시 대화"}><Icon name="branch" /><span>{chat.label}</span></button>
                  <button className="workspace-file-tab-close" type="button" aria-label={`${chat.label} 탭 닫기`} title="탭 닫기" onClick={() => closeSideChat(chat)}><Icon name="close" /></button>
                </div>;
              })}
              {terminalContext && <div className={`workspace-file-tab conversation-tab ${activeTab === "terminal" ? "active" : ""}`} role="presentation">
                <button className="workspace-file-tab-select" role="tab" aria-selected={activeTab === "terminal"} onClick={() => setActiveTab("terminal")} title={terminalContext.cwd}><Icon name="terminal" /><span>터미널</span></button>
                <button className="workspace-file-tab-close" type="button" aria-label="터미널 탭 닫기" title="탭 닫기" onClick={closeTerminalTab}><Icon name="close" /></button>
              </div>}
              {workspaceFileTabs.map((tab) => {
                const tabId: WorkspaceTab = `file:${tab.id}`;
                const isActive = activeTab === tabId;
                const fileName = basename(tab.file.path);
                return <div className={`workspace-file-tab conversation-tab ${isActive ? "active" : ""}`} key={tab.id} role="presentation">
                  <button className="workspace-file-tab-select" role="tab" aria-selected={isActive} title={tab.file.path} onClick={() => setActiveTab(tabId)}><Icon name="files" /><span>{fileName}</span></button>
                  <button className="workspace-file-tab-close" type="button" aria-label={`${fileName} 탭 닫기`} title="탭 닫기" onClick={() => closeWorkspaceFileTab(tab.id)}><Icon name="close" /></button>
                </div>;
              })}
              <button ref={tabCreateButtonRef} className="side-chat-add" type="button" aria-label="탭 추가" aria-expanded={tabCreateMenuOpen} title="탭 추가" onClick={(event) => toggleTabCreateMenu(event.currentTarget)}><Icon name="plus" /></button>
            </div>
            {activeTab === "chat" && activeThreadId && <>
              <div className="conversation-scroll" ref={conversationRef}><div className="conversation-inner">
                <div className="conversation-date"><span />{targetDisplay(connectedTarget)} · {activeThreadId.slice(0, 8)}<span /></div>
                {openingThread && <div className="inline-state">원격 대화 기록을 가져오는 중…</div>}
                {!openingThread && entries.length === 0 && <div className="empty-conversation"><div className="empty-icon"><Icon name="message" /></div><h2>대화 기록이 없습니다</h2><p>메시지를 보내면 {threadProviderName}가 이 세션을 이어갑니다.</p></div>}
                {groupTranscriptEntries(entries).map((block) => {
                  if (block.kind === "activity") return <ActivityGroup key={block.id} entries={block.entries} />;
                  const copyText = assistantResponseTextForEntry(block.entry, entries, !activeThreadHasUnfinishedResponse);
                  const canFork = canForkTranscriptEntry(block.entry, copyText !== undefined);
                  return <Transcript
                    key={block.entry.id}
                    entry={block.entry}
                    cwd={activeCwd}
                    onOpenFile={openWorkspaceMarkdownFile}
                    copyText={copyText}
                    onFork={canFork ? () => void forkCompletedResponse(block.entry) : undefined}
                    forking={forkingEntryId === block.entry.id}
                  />;
                })}
                {busy && <div className="working-indicator"><span /><span /><span /> {threadProviderName}가 응답 중입니다 · {formatElapsed(busyElapsed)}</div>}
              </div></div>
              <div className="composer-area">
                {notice && <div className="inline-notice" role="status"><Icon name="info" />{notice}<button className="icon-button" onClick={() => setNotice("")}><Icon name="close" /></button></div>}
                <div className="composer-wrap">
                  {selectedSkill && <div className="selected-skill-chip"><span>{selectedSkill.provider}</span><b>{selectedSkill.name}</b><button type="button" aria-label="선택한 스킬 해제" title="스킬 해제" onClick={() => setSelectedSkill(null)}><Icon name="close" /></button></div>}
                  {slashMenuOpen && <div className="slash-skill-menu" role="listbox" aria-label="현재 세션에서 사용할 수 있는 명령과 스킬" aria-activedescendant={visibleSlashItems[slashSkillIndex] ? `slash-skill-${slashSkillIndex}` : undefined}>
                    <div className="slash-skill-heading"><b>현재 세션 명령 및 스킬</b><small>{slashSkillLoading ? "목록 새로고침 중…" : `${visibleSlashItems.length}개`}</small></div>
                    {visibleSlashItems.map((item, index) => {
                      const label = item.kind === "command" ? `/${item.command.name}` : item.skill.name;
                      const description = item.kind === "command" ? item.command.description : item.skill.description || item.skill.id;
                      const provider = item.kind === "command" ? `${item.command.provider} · 명령` : item.skill.provider;
                      const key = item.kind === "command" ? `${item.command.provider}:command:${item.command.name}` : `${item.skill.provider}:skill:${item.skill.id}`;
                      return <button key={key} id={`slash-skill-${index}`} type="button" role="option" aria-selected={index === slashSkillIndex} className={`slash-skill-option ${index === slashSkillIndex ? "active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSlashMenuItem(item)}>
                        <span className="slash-skill-glyph">{item.kind === "command" ? "›" : "/"}</span><span className="slash-skill-copy"><b>{label}</b><small>{description || (item.kind === "command" && item.command.takesArguments ? "명령 인자를 입력할 수 있습니다." : "")}</small></span><span className="slash-skill-provider">{provider}</span>
                      </button>;
                    })}
                    {!slashSkillLoading && !visibleSlashItems.length && <div className="slash-skill-empty">{skillWarnings.length ? skillWarnings[0] : skills.length || slashCommands.length ? "일치하는 명령 또는 스킬이 없습니다." : "현재 세션에서 사용할 수 있는 명령과 스킬이 없습니다."}</div>}
                  </div>}
                  {threadProvider === "kiro" && <div className="composer-image-control"><input ref={imageInputRef} className="composer-image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addKiroImages(files); }} /><button type="button" disabled={busy || openingThread} onClick={() => imageInputRef.current?.click()} aria-label="Kiro 이미지 첨부" title="이미지 첨부 또는 붙여넣기"><Icon name="files" />이미지 첨부</button></div>}
                  {threadProvider === "kiro" && imageAttachments.length > 0 && <div className="composer-image-attachments">{imageAttachments.map((image) => <div className="composer-image-attachment" key={image.id}><img src={`data:${image.mimeType};base64,${image.data}`} alt="" /><span title={image.name}>{image.name}</span><button type="button" disabled={busy} onClick={() => removeKiroImage(image.id)} aria-label={`${image.name} 첨부 제거`} title="첨부 제거"><Icon name="close" /></button></div>)}</div>}
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    onPaste={(event) => {
                      if (threadProvider !== "kiro" || busy) return;
                      const files = Array.from(event.clipboardData.items).flatMap((item) => {
                        if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
                        const file = item.getAsFile();
                        return file ? [file] : [];
                      });
                      if (files.length) { event.preventDefault(); void addKiroImages(files); }
                    }}
                    placeholder={busy ? "현재 작업에 추가할 메시지 입력…" : "현재 세션에 메시지 보내기…"}
                    rows={2}
                    disabled={connectionState !== "connected"}
                  />
                  <div className="composer-controls"><div className="composer-tools"><button className="model-pill" type="button" onClick={() => setModelSettingsDialogOpen(true)} aria-haspopup="dialog" aria-expanded={modelSettingsDialogOpen} title={`${selectedModel?.description ? `${selectedModel.description} · ` : ""}${displayedEffort ? `사고 수준: ${effortLabel(displayedEffort)}` : `${threadProviderName} 모델 및 세션 설정`}`}><span className="model-dot" /><span className="model-pill-name">{selectedModel?.displayName || currentModel || "모델 설정"}</span>{displayedEffort && <span className="model-pill-effort">{effortLabel(displayedEffort)}</span>}</button></div><div className="composer-actions">{busy && !draft.trim() && <button className="send-button stop-button" disabled={stoppingTurn} onClick={() => void stopTurn()} title={stoppingTurn ? "중지 요청 중" : `${threadProviderName} 작업 중지`} aria-label={stoppingTurn ? "중지 요청 중" : "작업 중지"}><Icon name={stoppingTurn ? "refresh" : "stop"} /></button>}{(!busy || Boolean(draft.trim())) && <button className={`send-button ${busy ? "steer-button" : ""}`} disabled={!draft.trim() || !activeThreadId || (busy && (stoppingTurn || steeringPrompt))} onClick={() => void sendPrompt()} title={busy ? threadProvider === "codex" ? "현재 작업에 메시지 전달" : "응답이 끝난 뒤 메시지를 보내세요" : "보내기"} aria-label={busy ? steeringPrompt ? "현재 작업에 메시지 전달 중" : "현재 작업에 메시지 전달" : "메시지 보내기"}>{busy ? <><Icon name={steeringPrompt ? "refresh" : "arrow-up"} /></> : <Icon name="arrow-up" />}</button>}</div></div>
                </div>
              </div>
            </>}
            {activeTab === "chat" && !activeThreadId && (
              <div className="empty-state">
                <div className="empty-icon"><Icon name="message" /></div>
                <h2>{connectionState === "connected" ? `${assistantProviderName} 세션을 선택하세요` : `${assistantProviderName}에 연결하세요`}</h2>
                <p>{connectionState === "connected" ? "왼쪽에서 기존 세션을 선택하거나 현재 워크스페이스에서 새 세션을 만드세요." : `${assistantProviderName}에 연결하면 세션과 대화를 불러올 수 있습니다.`}</p>
                {connectionState === "connected" ? <button className="dialog-primary" onClick={() => openNewSessionDialog("workspace") } disabled={creatingSession}>새 워크스페이스</button> : <button onClick={() => openSettings("connection")}>SSH 호스트 연결</button>}
                {notice && <div className="inline-notice" role="status"><Icon name="info" />{notice}</div>}
              </div>
            )}
            {terminalContext && <div className="workspace-tab-panel" hidden={activeTab !== "terminal"}><TerminalPanel target={terminalContext.target} cwd={terminalContext.cwd} /></div>}
            {activeFileTab && activeTab === `file:${activeFileTab.id}` && <FileDocument file={activeFileTab.file} />}
          </section>
        </div>
        </>}
        {activePage === "skills" && <section className="feature-page skills-page">
          <div className="feature-heading"><span className="eyebrow">REMOTE CATALOG</span><h1>Skills</h1><p>현재 세션의 provider host와 작업공간에서 사용할 수 있는 스킬입니다.</p></div>
          <div className="feature-toolbar"><label className="skill-search"><Icon name="sparkles" /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="이름, 설명, 제공자로 검색" /></label><span>{visibleSkills.length}개 표시</span></div>
          {connectionState !== "connected" && <div className="feature-empty"><div className="empty-icon"><Icon name="branch" /></div><h2>호스트를 먼저 연결하세요</h2><p>호스트에 연결한 뒤 세션을 열면 사용할 수 있는 스킬 목록을 가져옵니다.</p><button className="dialog-primary" onClick={() => openSettings("connection")}>연결 설정 열기</button></div>}
          {connectionState === "connected" && !activeThreadId && <div className="feature-empty"><div className="empty-icon"><Icon name="message" /></div><h2>세션을 열어 스킬을 불러오세요</h2><p>스킬 카탈로그는 현재 세션의 원격 작업공간 기준으로 검색됩니다.</p><button className="dialog-primary" onClick={() => setActivePage("sessions")}>세션 페이지 열기</button></div>}
          {skillWarnings.map((warning) => <div className="skill-warning" key={warning}>{warning}</div>)}
          {connectionState === "connected" && activeThreadId && <div className="skill-grid">{visibleSkills.map((skill) => <article className="skill-card" key={`${skill.provider}-${skill.id}`}><div className="skill-card-icon"><Icon name="sparkles" /></div><div className="skill-card-copy"><div className="skill-card-title"><h2>{skill.name}</h2><span>{skill.provider}</span></div><p>{skill.description || "설명이 제공되지 않았습니다."}</p><small>{skill.scope}</small></div><button className="dialog-secondary" disabled={!skill.enabled} onClick={() => { setSelectedSkill(skill); setDraft(""); setActivePage("sessions"); }}><Icon name="arrow-up-right" /> 세션에서 사용</button></article>)}</div>}
          {connectionState === "connected" && activeThreadId && !visibleSkills.length && <div className="feature-empty"><div className="empty-icon"><Icon name="sparkles" /></div><h2>{skills.length ? "검색 결과가 없습니다" : "등록된 스킬이 없습니다"}</h2><p>{skills.length ? "다른 검색어를 입력해 보세요." : "원격 호스트의 스킬 디렉터리에서 사용할 수 있는 스킬을 찾지 못했습니다."}</p></div>}
        </section>}
        {activePage === "settings" && settingsSection === "theme" && <section className="feature-page settings-page">
          <div className="feature-heading"><span className="eyebrow">SETTINGS / THEME</span><h1>테마</h1><p>Hive 앱의 화면 표시 방식을 설정합니다.</p></div>
          <section className="settings-panel" aria-labelledby="appearance-settings-title">
            <div className="settings-panel-heading"><div><span className="eyebrow">APPEARANCE</span><h2 id="appearance-settings-title">화면 모드</h2></div></div>
            <div className="settings-preference-row"><div><b>테마</b><p>{theme === "dark" ? "어두운 화면으로 표시합니다." : "밝은 화면으로 표시합니다."}</p></div>
              <button
                className="theme-toggle settings-theme-toggle"
                type="button"
                role="switch"
                aria-checked={theme === "dark"}
                aria-label={theme === "dark" ? "다크 모드" : "라이트 모드"}
                title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
                onClick={() => setTheme((current) => {
                  const next = current === "dark" ? "light" : "dark";
                  localStorage.setItem("hive.theme", next);
                  return next;
                })}
              >
                <Icon name={theme === "dark" ? "moon" : "sun"} />
                <span>{theme === "dark" ? "다크 모드" : "라이트 모드"}</span>
                <span className="theme-switch-track" aria-hidden="true"><span /></span>
              </button>
            </div>
          </section>
        </section>}
        {activePage === "settings" && settingsSection === "connection" && <section className="feature-page connection-page">
          <div className="feature-heading"><span className="eyebrow">SETTINGS / CONNECTION</span><h1>연결</h1><p>{assistantProvider === "codex" ? isDaemonClient ? "페어링한 데몬이 실행 중인 컴퓨터의 Codex에 연결합니다." : "SSH 또는 TCP 릴레이를 통해 Codex가 설치된 호스트에 연결합니다." : assistantProvider === "kiro" ? `${isDaemonClient ? "Hive 데몬" : "Hive 실행 프로세스"}에서 Kiro CLI 세션을 연결합니다.` : `${isDaemonClient ? "Hive 데몬" : "Hive 실행 프로세스"}에 설정된 OpenCode provider에 연결합니다. 모델 인증 정보는 OpenCode에서 관리합니다.`}</p></div>
          <div className="connection-layout">
            {isDaemonClient ? <div className="connection-form-card">
              <div className="connection-card-heading"><div className="connection-card-icon"><Icon name="branch" /></div><div><h2>데몬의 로컬 provider</h2><p>작업공간, 터미널, 파일은 데몬 호스트에서 처리합니다.</p></div></div>
              <label htmlFor="assistant-provider">Provider</label><select id="assistant-provider" value={assistantProvider} disabled={busy} onChange={(event) => chooseProvider(event.target.value as AssistantProvider, true)}>{availableProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
              {assistantProvider === "opencode" ? <>
                <div className="dialog-help">Hive 데몬이 시작할 때 <code>opencode serve</code>를 실행하고 CLI가 출력한 서버 비밀번호로 자동 연결합니다. 기본 주소는 <code>http://127.0.0.1:4096</code>입니다. CLI가 PATH에 없으면 <code>HIVE_OPENCODE_BIN</code>을 지정하세요. 기존 OpenCode 서버를 사용하려면 데몬에 <code>HIVE_OPENCODE_URL</code>, 필요하면 <code>HIVE_OPENCODE_USERNAME</code>과 <code>HIVE_OPENCODE_PASSWORD</code>를 설정하고 다시 시작하세요.</div>
              </> : assistantProvider === "kiro" ? <div className="dialog-help">데몬 호스트에 Kiro CLI를 설치하고 로그인하세요. 세션과 모델은 해당 Kiro CLI 계정에서 관리됩니다.</div> : <div className="dialog-help">Android 페어링 후 데몬이 실행된 컴퓨터의 Codex CLI에 연결합니다. 새 세션, 터미널, 파일 작업도 이 컴퓨터에서 실행됩니다.</div>}
              {notice && connectionState !== "connected" && <div className="connection-error">{notice}</div>}
              {modelWarning && <div className="skill-warning">{modelWarning}</div>}
              <div className="connection-form-actions"><button type="button" className="dialog-primary" onClick={() => void connect(undefined, LOCAL_MOBILE_TARGET)} disabled={connectionState === "connecting"}>{connectionState === "connecting" ? "연결 중…" : connectionState === "connected" ? "세션 목록 새로고침" : `${assistantProviderName} 연결`}</button>{connectionState === "connected" && <button type="button" className="dialog-secondary" onClick={() => void disconnect()}>연결 끊기</button>}</div>
            </div> : <form className="connection-form-card" onSubmit={(event) => void connect(event)}>
              <div className="connection-card-heading"><div className="connection-card-icon"><Icon name="branch" /></div><div><h2>{assistantProviderName} provider</h2><p>세션 provider와 작업공간 host를 설정합니다.</p></div></div>
              <label htmlFor="assistant-provider">Provider</label><select id="assistant-provider" value={assistantProvider} disabled={busy} onChange={(event) => chooseProvider(event.target.value as AssistantProvider, true)}>{availableProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
              <label htmlFor="ssh-target">작업공간 host (선택)</label><input id="ssh-target" type={target.startsWith("hive+") ? "password" : "text"} value={target} onChange={(event) => setTarget(event.target.value)} placeholder="로컬은 비워 두기 · 또는 user@host / hive+tcp://…" disabled={connectionState === "connecting"} />
              {assistantProvider === "opencode" ? <>
                <div className="dialog-help">Hive 실행 프로세스가 <code>opencode serve</code>를 자동 실행하고 CLI가 출력한 서버 비밀번호로 연결합니다. 기본 주소는 <code>http://127.0.0.1:4096</code>입니다. CLI가 PATH에 없으면 <code>HIVE_OPENCODE_BIN</code>을 지정하세요. 기존 서버를 쓰려면 <code>HIVE_OPENCODE_URL</code>과 필요한 인증 변수를 설정하세요. provider API 키는 OpenCode에서 관리합니다.</div>
              </> : assistantProvider === "kiro" ? <div className="dialog-help">로컬은 비워 두거나 SSH host에 Kiro CLI를 설치하고 로그인하세요. SSH host에서는 비대화형 셸 PATH에 <code>kiro-cli</code>가 있어야 합니다. Kiro는 TCP 릴레이를 지원하지 않습니다. 로컬 CLI 경로를 지정하려면 Hive에 <code>HIVE_KIRO_BIN</code>을 설정하세요.</div> : <div className="dialog-help">SSH host에는 Codex CLI와 공개키 로그인이 필요합니다. 릴레이 연결에는 원격 host에서 Hive CLI의 <code>hive daemon</code>이 실행 중이어야 합니다. 비워 두면 이 컴퓨터의 Codex를 사용합니다.</div>}
              {notice && connectionState !== "connected" && <div className="connection-error">{notice}</div>}
              {modelWarning && <div className="skill-warning">{modelWarning}</div>}
              <div className="connection-form-actions"><button type="submit" className="dialog-primary" disabled={(assistantProvider === "codex" && !target.trim()) || connectionState === "connecting"}>{connectionState === "connecting" ? "연결 중…" : "연결 및 세션 불러오기"}</button>{connectionState === "connected" && <button type="button" className="dialog-secondary" onClick={() => void disconnect()}>연결 끊기</button>}</div>
            </form>}
            <aside className="connection-info-card"><span className="eyebrow">CONNECTION STATUS</span><div className={`connection-large-status ${connectionState}`}><i />{connectionState === "connected" ? "연결됨" : connectionState === "connecting" ? "연결 중" : "연결되지 않음"}</div><dl><dt>Provider</dt><dd>{assistantProvider === "codex" ? "Codex app-server" : assistantProvider === "kiro" ? "Kiro CLI / ACP" : "OpenCode HTTP API"}</dd><dt>작업공간 host</dt><dd>{targetDisplay(connectedTarget || target) || (assistantProvider !== "codex" ? "이 컴퓨터" : "설정되지 않음")}</dd><dt>Provider 설정</dt><dd>{assistantProvider === "opencode" ? (isDaemonClient ? "Hive 데몬 환경" : "Hive 실행 환경") : assistantProvider === "kiro" ? (isDaemonClient ? "데몬 호스트의 Kiro CLI" : "로컬 또는 SSH의 Kiro CLI") : isDaemonClient ? "데몬 호스트의 Codex CLI" : "SSH 또는 Hive 릴레이"}</dd></dl><p>{assistantProvider === "opencode" ? `Hive ${isDaemonClient ? "데몬" : "실행 프로세스"}가 설정된 serve API에 연결합니다. 서버 주소와 인증은 Hive 환경 변수에서 관리합니다.` : assistantProvider === "kiro" ? "Kiro CLI 로그인 정보와 모델 설정을 사용합니다. 세션 생성·불러오기·삭제는 Kiro CLI를 통해 처리합니다." : isDaemonClient ? "Codex는 데몬을 실행한 컴퓨터의 사용자 계정과 설정을 사용합니다." : "SSH는 공개키 로그인, 릴레이는 pair token으로 원격 host에 연결합니다."}</p>{onMobileDisconnect && <button className="dialog-secondary mobile-change-desktop" onClick={onMobileDisconnect}>데몬 연결 설정 변경</button>}{onUseDirectConnection && <button className="dialog-secondary" onClick={onUseDirectConnection}>SSH 또는 릴레이로 직접 연결</button>}{onUseDaemonConnection && <button className="dialog-secondary" onClick={onUseDaemonConnection}>Hive 데몬에 연결</button>}</aside>
          </div>
        </section>}
      </main>

      {activePage === "sessions" && filePanelInitialized && <aside ref={filesPanelRef} className={`files-side-panel ${filePanelOpen ? "" : "file-panel-closed"}`} aria-label="파일 패널" aria-hidden={!filePanelOpen} inert={!filePanelOpen}>
        <FilesPanel target={connectedTarget} cwd={activeCwd} openFileRequest={workspaceFileOpenRequest} onOpenFileRequestHandled={handleWorkspaceFileOpenHandled} onOpenFile={openWorkspaceFileTab} />
      </aside>}

      {tabCreateMenuOpen && tabCreateMenuPosition && createPortal(<div ref={tabCreateMenuRef} className="tab-create-menu" style={tabCreateMenuPosition} role="menu">
        <button type="button" role="menuitem" disabled={!activeThreadId || creatingSideChat || openingThread} onClick={() => { setTabCreateMenuOpen(false); void createSideChat(); }}><Icon name="message" /><span>{creatingSideChat ? "여는 중…" : "새 대화"}</span></button>
        {!terminalContext && <button type="button" role="menuitem" disabled={!connectedTarget || !activeCwd} onClick={openTerminalTab}><Icon name="terminal" /><span>터미널</span></button>}
      </div>, document.body)}

      {modelSettingsDialogOpen && activeThreadId && <div className="dialog-backdrop model-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !updatingSettings) setModelSettingsDialogOpen(false); }}>
        <section className="connect-dialog model-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
          <div className="model-settings-heading"><div><span className="eyebrow">SESSION SETTINGS</span><h2 id="model-settings-title">모델 및 세션 설정</h2></div><button className="icon-button" type="button" aria-label="설정 닫기" title="설정 닫기" onClick={() => setModelSettingsDialogOpen(false)} disabled={updatingSettings}><Icon name="close" /></button></div>
          <div className="model-controls">
            <label className="model-control"><span>모델</span><select aria-label={`${threadProviderName} 모델`} value={currentModel} disabled={updatingSettings || busy || models.length === 0} onChange={(event) => changeModel(event.target.value)} title={selectedModel?.description || modelWarning || `${threadProviderName} 모델 선택`}>
              {currentModel && !models.some((model) => model.model === currentModel && !model.hidden) && <option value={currentModel}>{selectedModel?.displayName ?? currentModel}{selectedModel?.hidden ? " · 숨김" : " · 현재"}</option>}
              {models.filter((model) => !model.hidden).map((model) => <option key={model.model} value={model.model}>{model.displayName}{model.isDefault ? " · 기본" : ""}</option>)}
              {!models.length && <option value="">{modelWarning ? "모델 목록을 불러오지 못함" : "모델 없음"}</option>}
            </select></label>
            {(threadProvider === "codex" || threadProvider === "kiro") && <label className="model-control thinking-control"><span>Thinking</span><select aria-label="Thinking 수준" value={displayedEffort} disabled={updatingSettings || busy || reasoningOptions.length === 0} onChange={(event) => void updateSettings({ effort: event.target.value })} title="다음 턴부터 적용됩니다">
              {reasoningOptions.map((option) => <option key={option.reasoningEffort} value={option.reasoningEffort}>{effortLabel(option.reasoningEffort)}</option>)}
              {!reasoningOptions.length && <option value="">지원 옵션 없음</option>}
            </select></label>}
          {threadProvider === "kiro" && currentModes.length > 0 && <label className="model-control"><span>에이전트</span><select aria-label="Kiro 에이전트 모드" value={currentModeId ?? ""} disabled={updatingSettings || busy} onChange={(event) => void updateSettings({ modeId: event.target.value })} title="Kiro 세션 에이전트 모드">
              {currentModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
            </select></label>}
            {threadProvider === "kiro" && <p className="dialog-help">시작 권한: {currentPermissionProfile ? currentPermissionProfile.split(",").map((id) => KIRO_POLICY_PRESETS.find((preset) => preset.id === id)?.label ?? id).join(" · ") : "Kiro 기본 승인 흐름"}. 권한 프리셋은 새 세션을 만들 때 설정합니다.</p>}
            {threadProvider === "codex" && <label className="model-control permission-control"><span>권한</span><select aria-label="Codex 권한" value={currentPermissionProfile ?? ""} disabled={updatingSettings || busy} onChange={(event) => {
              const preset = PERMISSION_PRESETS.find((candidate) => candidate.id === event.target.value);
              if (preset) void updateSettings({ permissionProfile: preset.id });
            }} title={PERMISSION_PRESETS.find((preset) => preset.id === currentPermissionProfile)?.description ?? "Codex 세션의 파일 및 네트워크 접근 권한"}>
              {!currentPermissionProfile && <option value="" disabled>현재 권한</option>}
              {currentPermissionProfile && !PERMISSION_PRESETS.some((preset) => preset.id === currentPermissionProfile) && <option value={currentPermissionProfile}>{`현재 · ${currentPermissionProfile}`}</option>}
              {PERMISSION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select></label>}
          </div>
          {modelWarning && <p className="dialog-help" role="status">{modelWarning}</p>}
        </section>
      </div>}

      {newSessionDialogOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !creatingSession) setNewSessionDialogOpen(false); }}>
        <form className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="new-session-dialog-title" onSubmit={(event) => { event.preventDefault(); void createSessionInWorkspace(newSessionPath, newSessionName); }}>
          <div className="dialog-mark"><Icon name="plus" /></div>
          <h2 id="new-session-dialog-title">{newSessionDialogMode === "workspace" ? "새 워크스페이스" : "새 세션"}</h2>
          <p>{newSessionDialogMode === "workspace" ? "작업할 폴더를 선택하고 프로바이더를 정해 새 워크스페이스를 시작하세요." : `같은 ${newSessionPath.split(/[\\/]/).filter(Boolean).at(-1) || "워크스페이스"} 폴더에서 선택한 프로바이더로 새 대화를 시작하세요.`}</p>
          <label htmlFor="new-session-provider">프로바이더</label>
          <select id="new-session-provider" aria-label="새 세션 프로바이더 선택" value={assistantProvider} disabled={creatingSession || busy} onChange={(event) => chooseProvider(event.target.value as AssistantProvider, true)}>
            {availableProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
          <label htmlFor="new-session-name">{newSessionDialogMode === "workspace" ? "첫 세션 이름 (선택)" : "세션 이름 (선택)"}</label>
          <input id="new-session-name" value={newSessionName} onChange={(event) => { setNewSessionName(event.target.value); setNewSessionError(""); }} placeholder={`비워 두면 ${assistantProviderName}가 자동으로 정합니다`} maxLength={120} disabled={creatingSession} />
          {assistantProvider === "kiro" && <fieldset className="kiro-permission-presets"><legend>Kiro 시작 권한 (선택)</legend>
            {KIRO_POLICY_PRESETS.map((preset) => <label key={preset.id} title={preset.description}><input type="checkbox" checked={newKiroPolicyPresets.includes(preset.id)} disabled={creatingSession} onChange={(event) => setNewKiroPolicyPresets((current) => event.target.checked ? [...current, preset.id] : current.filter((id) => id !== preset.id))} /><span><b>{preset.label}</b><small>{preset.description}</small></span></label>)}
            <p>선택한 권한은 추가 허용 규칙으로 적용됩니다. 비워 두면 Kiro 기본 승인 흐름을 사용하며, 거부 규칙은 허용 규칙보다 우선합니다.</p>
          </fieldset>}
          <label htmlFor="new-session-path">{newSessionDialogMode === "workspace" ? "워크스페이스 폴더" : "현재 워크스페이스 폴더"}</label>
          <div className="workspace-folder-field">
            <input id="new-session-path" value={newSessionPath} onChange={(event) => { setNewSessionPath(event.target.value); setNewSessionError(""); }} placeholder="/home/user/project" autoFocus disabled={newSessionDialogMode === "session" || creatingSession || choosingWorkspaceFolder} />
            {newSessionDialogMode === "workspace" && isLinuxDesktop && isDaemonClient && <button className="dialog-secondary" type="button" onClick={() => void chooseWorkspaceFolder()} disabled={creatingSession || choosingWorkspaceFolder}><Icon name={choosingWorkspaceFolder ? "refresh" : "folder"} />{choosingWorkspaceFolder ? "폴더 여는 중…" : "폴더 선택"}</button>}
          </div>
          {newSessionError && <div className="connection-error">{newSessionError}</div>}
          {connectionState !== "connected" || connectedProvider !== assistantProvider ? <div className="connection-error">{connectionState === "connecting" ? `${assistantProviderName}에 연결 중입니다…` : `${assistantProviderName} 연결이 완료되면 시작할 수 있습니다.`}</div> : null}
          <div className="dialog-help">{newSessionDialogMode === "workspace" ? "선택한 폴더를 워크스페이스로 사용하고 첫 세션을 만듭니다." : "선택한 워크스페이스 폴더에 새 세션을 추가합니다. 기존 세션과 대화 기록은 그대로 유지됩니다."}</div>
          <div className="dialog-actions">
            <button type="button" className="dialog-secondary" onClick={() => setNewSessionDialogOpen(false)} disabled={creatingSession || choosingWorkspaceFolder}>취소</button>
            <button type="submit" className="dialog-primary" disabled={!newSessionPath.trim() || connectionState !== "connected" || connectedProvider !== assistantProvider || creatingSession || choosingWorkspaceFolder}>{creatingSession ? "시작하는 중…" : newSessionDialogMode === "workspace" ? "워크스페이스 시작" : "세션 시작"}</button>
          </div>
        </form>
      </div>}
      {renameDialog && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !renamingSession) setRenameDialog(null); }}>
        <form className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-session-dialog-title" onSubmit={(event) => { event.preventDefault(); void saveSessionName(); }}>
          <div className="dialog-mark"><Icon name="edit" /></div>
          <h2 id="rename-session-dialog-title">세션 이름 수정</h2>
          <p>{assistantProviderName} 세션 목록에 표시할 이름을 입력하세요.</p>
          <label htmlFor="rename-session-name">세션 이름</label>
          <input id="rename-session-name" value={renameSessionName} onChange={(event) => { setRenameSessionName(event.target.value); setRenameSessionError(""); }} autoFocus maxLength={120} disabled={renamingSession} />
          {renameSessionError && <div className="connection-error">{renameSessionError}</div>}
          <div className="dialog-actions">
            <button type="button" className="dialog-secondary" onClick={() => setRenameDialog(null)} disabled={renamingSession}>취소</button>
            <button type="submit" className="dialog-primary" disabled={!renameSessionName.trim() || renamingSession}>{renamingSession ? "저장 중…" : "이름 저장"}</button>
          </div>
        </form>
      </div>}
      {approval && <div className="dialog-backdrop"><div className="approval-dialog"><div className="approval-mark"><Icon name="info" /></div><h2>{providerDisplayName(approval.provider)} 권한 요청</h2><p>{approval.method.includes("commandExecution") || approval.method.includes("permission") ? "원격 컴퓨터에서 도구를 실행하려 합니다." : "원격 세션의 파일 변경을 적용하려 합니다."}</p><ApprovalDetails approval={approval} /><div className="dialog-actions"><button className="dialog-secondary" onClick={() => void answerApproval("decline")}>거절</button><button className="dialog-secondary" onClick={() => void answerApproval("acceptForSession")}>세션 동안 허용</button><button className="dialog-primary" onClick={() => void answerApproval("accept")}>이번만 허용</button></div></div></div>}
      {deleteDialog && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingSession) setDeleteDialog(null); }}>
        <div className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-session-dialog-title">
          <div className="dialog-mark"><Icon name="trash" /></div>
          <h2 id="delete-session-dialog-title">세션 삭제</h2>
          <p>“{deleteDialog.title}” 세션과 대화 기록을 영구 삭제할까요? 삭제한 기록은 복구할 수 없습니다.</p>
          {runningThreads.current.has(runningThreadKey(connectedTarget, deleteDialog.provider, deleteDialog.id)) && <div className="connection-error" role="status">작업 중인 세션은 먼저 작업을 중지한 뒤 삭제할 수 있습니다.</div>}
          {deleteSessionError && <div className="connection-error" role="alert">{deleteSessionError}</div>}
          <div className="dialog-actions">
            <button type="button" className="dialog-secondary" onClick={() => setDeleteDialog(null)} disabled={deletingSession}>취소</button>
            <button type="button" className="dialog-danger" onClick={() => void deleteSession()} disabled={deletingSession || runningThreads.current.has(runningThreadKey(connectedTarget, deleteDialog.provider, deleteDialog.id))}>
              {deletingSession ? "삭제 중…" : "영구 삭제"}
            </button>
          </div>
        </div>
      </div>}
      <div className="window-resize-grips" aria-hidden="true" hidden={windowMaximized || newSessionDialogOpen || Boolean(renameDialog) || Boolean(deleteDialog) || Boolean(approval)}>
        {WINDOW_RESIZE_EDGES.map((edge) => <div
          key={edge}
          className={`window-resize-grip resize-${edge}`}
          onPointerDown={(event) => void beginWindowResize(event, edge)}
          onPointerMove={moveWindowResize}
          onPointerUp={endWindowResize}
          onPointerCancel={endWindowResize}
        />)}
      </div>
    </div>
  );
}

const Transcript = memo(function Transcript({ entry, cwd, onOpenFile, copyText, onFork, forking = false }: { entry: TranscriptEntry; cwd?: string; onOpenFile?: (path: string) => void; copyText?: string; onFork?: () => void; forking?: boolean }) {
  if (entry.role === "user") return <div className="user-entry"><div className="user-bubble markdown-body"><MessageMarkdown text={entry.text} cwd={cwd ?? ""} onOpenFile={onOpenFile} />{entry.images?.length ? <div className="transcript-images">{entry.images.map((image) => <img key={`${image.name}:${image.data.length}`} src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} title={image.name} loading="lazy" />)}</div> : null}</div><CopyTranscriptButton text={entry.text} /></div>;
  if (entry.role === "tool") {
    const isWebSearch = entry.toolType === "webSearch";
    const label = isWebSearch ? "웹 검색" : "명령";
    return <details className="tool-card"><summary className="tool-card-heading"><span className="tool-icon"><Icon name={isWebSearch ? "search" : "terminal"} /></span><b>{entry.status === "inProgress" ? (isWebSearch ? "검색 중" : "실행 중") : label}</b><code>{entry.command || entry.text}</code><span className={`tool-state ${entry.status === "failed" ? "failed" : ""}`}>{entry.status === "inProgress" ? (isWebSearch ? "검색 중" : "실행 중") : entry.status ?? "완료"}</span><Icon name="chevron-down" /></summary><div className="tool-card-details">{entry.command && <pre className="tool-command">{entry.command}</pre>}{entry.output && <pre>{entry.output}</pre>}</div></details>;
  }
  if (entry.role === "change") return <div className="change-summary"><span className="change-icon"><Icon name="files" /></span><b>{entry.status === "inProgress" ? "파일 변경 중" : "파일 변경"}</b><span className="change-detail">{entry.text}</span></div>;
  return <div className="assistant-entry"><div className="assistant-body"><div className="transcript-text markdown-body"><MessageMarkdown text={entry.text} cwd={cwd ?? ""} onOpenFile={onOpenFile} /></div></div>{copyText !== undefined && <div className="assistant-entry-actions"><CopyTranscriptButton text={copyText} />{onFork && <button className="message-copy-button message-fork-button" type="button" disabled={forking} onClick={onFork} aria-label="이 AI 응답까지 영구 포크 세션 만들기" title="이 응답까지 영구 세션으로 포크"><Icon name={forking ? "refresh" : "branch"} /><span>{forking ? "포크 중…" : "포크"}</span></button>}</div>}</div>;
});

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

const ActivityGroup = memo(function ActivityGroup({ entries }: { entries: TranscriptEntry[] }) {
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

  return <details className="activity-group"><summary className="activity-group-summary">
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

function ApprovalDetails({ approval }: { approval: Approval }) {
  const toolCall = asObject(approval.params.toolCall) ?? {};
  const command = displayValue(approval.params.command ?? toolCall.title);
  const cwd = stringValue(approval.params.cwd);
  const reason = stringValue(approval.params.reason ?? toolCall.kind);
  return <div className="approval-details">{reason && <p>{reason}</p>}{command !== "(unavailable)" && <pre>{command}</pre>}{cwd && <small>작업 경로: {cwd}</small>}</div>;
}

function groupThreads(threads: RemoteThread[]): Project[] {
  const groups = new Map<string, Project>();
  for (const thread of threads) {
    const path = thread.cwd || "";
    const key = path ? `cwd:${path}` : "unknown-workspace";
    const group = groups.get(key) ?? { key, name: path ? basename(path) : "원격 경로 없음", path, sessions: [] };
    group.sessions.push(thread);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, sessions: group.sessions.sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a)) }))
    .sort((a, b) => threadUpdatedAt(b.sessions[0]) - threadUpdatedAt(a.sessions[0]));
}

function threadViewKey(target: string, provider: AssistantProvider, threadId: string): string {
  return `${target}\u0000${provider}\u0000${threadId}`;
}

function runningThreadKey(target: string, provider: AssistantProvider, threadId: string): string {
  return threadViewKey(target, provider, threadId);
}

function providerDisplayName(provider: AssistantProvider): string {
  return provider === "codex" ? "Codex" : provider === "opencode" ? "OpenCode" : "Kiro";
}

function isGtkTitleButtonDecoration(item: string): boolean {
  return item === "minimize" || item === "maximize" || item === "close";
}

function readAppAssistantProvider(): AssistantProvider {
  const value = localStorage.getItem("hive.assistantProvider.v1");
  return ASSISTANT_PROVIDERS.find((provider) => provider.id === value)?.id ?? "codex";
}

async function disconnectProviderSessions(target: string): Promise<void> {
  await Promise.allSettled(ASSISTANT_PROVIDERS.map(({ id: provider }) => bridgeRpc.request.disconnect({ target, provider })));
}

function readPersistentForkTabs(): SideChatTab[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PERSISTENT_FORK_TABS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SideChatTab[] => {
      if (!item || typeof item !== "object") return [];
      const tab = item as Partial<SideChatTab>;
      if (tab.persistent !== true || typeof tab.target !== "string" || typeof tab.threadId !== "string" ||
          (tab.provider !== "codex" && tab.provider !== "opencode") || typeof tab.parentThreadId !== "string" ||
          typeof tab.rootThreadId !== "string" || typeof tab.label !== "string") return [];
      return [{ ...tab, persistent: true } as SideChatTab];
    });
  } catch {
    return [];
  }
}

function replaceProviderThreads(current: RemoteThread[], incoming: RemoteThread[], provider: AssistantProvider): RemoteThread[] {
  const byKey = new Map(current.filter((thread) => thread.provider !== provider).map((thread) => [`${thread.provider}\u0000${thread.id}`, thread]));
  for (const thread of incoming) byKey.set(`${provider}\u0000${thread.id}`, { ...thread, provider });
  return [...byKey.values()].sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a));
}

function upsertProviderThreads(current: RemoteThread[], incoming: RemoteThread[], provider: AssistantProvider): RemoteThread[] {
  const byKey = new Map(current.map((thread) => [`${thread.provider}\u0000${thread.id}`, thread]));
  for (const thread of incoming) byKey.set(`${provider}\u0000${thread.id}`, { ...thread, provider });
  return [...byKey.values()].sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a));
}

function threadUpdatedAt(thread: RemoteThread | undefined): number {
  if (!thread || thread.updatedAt === null) return 0;
  const parsed = timestampMillis(thread.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampMillis(value: string | number | null): number {
  if (value === null) return Number.NaN;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return Number.NaN;
    return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  }
  const trimmed = value.trim();
  if (/^-?\d{9,13}(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  }
  return Date.parse(trimmed);
}

function groupTranscriptEntries(entries: TranscriptEntry[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (let index = 0; index < entries.length;) {
    const entry = entries[index]!;
    if (entry.role !== "tool" && entry.role !== "change") {
      blocks.push({ kind: "entry", entry });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < entries.length && (entries[end]!.role === "tool" || entries[end]!.role === "change")) end += 1;
    const activity = entries.slice(index, end);
    blocks.push({ kind: "activity", id: entry.id, entries: activity });
    index = end;
  }
  return blocks;
}

function appendAssistantDelta(entries: TranscriptEntry[], id: string, delta: string, turnId: string, providerMessageId: string): TranscriptEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) return [...entries, { id, role: "assistant", text: delta, turnId, providerMessageId, responseCompleted: false, status: "inProgress" }];
  return entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, text: entry.text + delta, turnId, providerMessageId, responseCompleted: false, status: "inProgress" } : entry);
}

function canForkTranscriptEntry(entry: TranscriptEntry, responseComplete: boolean): boolean {
  if (entry.role !== "assistant" || entry.status === "inProgress" || !responseComplete) return false;
  return true;
}

function assistantResponseTextForEntry(entry: TranscriptEntry, entries: TranscriptEntry[], threadIdle: boolean): string | undefined {
  if (entry.role !== "assistant" || entry.status === "inProgress") return undefined;
  const index = entries.findIndex((candidate) => candidate.id === entry.id);
  if (index < 0) return undefined;
  let start = index;
  while (start > 0 && entries[start - 1]?.role !== "user") start -= 1;
  let end = index + 1;
  while (end < entries.length && entries[end]?.role !== "user") end += 1;
  const responseEntries = entries.slice(start, end).filter((candidate) => candidate.role === "assistant");
  if (responseEntries.some((candidate) => candidate.status === "inProgress")) return undefined;
  if (responseEntries.at(-1)?.id !== entry.id) return undefined;
  const hasFollowingUserMessage = end < entries.length;
  if (!hasFollowingUserMessage && !threadIdle) return undefined;
  return responseEntries.map((candidate) => candidate.text).filter(Boolean).join("\n\n");
}

function upsertEntry(entries: TranscriptEntry[], next: TranscriptEntry): TranscriptEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next];
  return entries.map((entry, entryIndex) => entryIndex === index ? next : entry);
}

function webSearchTranscriptEntries(
  item: Record<string, unknown>,
  id: string,
  status = stringValue(item.status) ?? "completed",
): TranscriptEntry[] {
  const action = asObject(item.action);
  const queries = Array.isArray(action?.queries)
    ? action.queries.flatMap((query) => typeof query === "string" && query.trim() ? [query.trim()] : [])
    : [];
  const searchQueries = queries.length ? queries : [stringValue(action?.query) ?? stringValue(item.query) ?? ""];
  return searchQueries.map((query, index) => ({
    id: searchQueries.length > 1 ? `${id}:query:${index + 1}` : id,
    role: "tool",
    text: "WebSearch",
    toolType: "webSearch",
    command: query || "검색 준비 중",
    output: stringValue(item.result) ?? stringValue(item.content) ?? "",
    status,
  }));
}

function replaceWebSearchEntries(entries: TranscriptEntry[], id: string, next: TranscriptEntry[]): TranscriptEntry[] {
  const isPreviousEntry = (entry: TranscriptEntry) => entry.id === id || entry.id.startsWith(`${id}:query:`);
  const firstIndex = entries.findIndex(isPreviousEntry);
  if (firstIndex < 0) return [...entries, ...next];
  const retainedBefore = entries.slice(0, firstIndex).filter((entry) => !isPreviousEntry(entry));
  const retainedAfter = entries.slice(firstIndex).filter((entry) => !isPreviousEntry(entry));
  return [...retainedBefore, ...next, ...retainedAfter];
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : stringValue(asObject(part)?.text) ?? "").filter(Boolean).join("\n");
}

function fileChangeSummary(item: Record<string, unknown>): string {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  return changes.map((change) => stringValue(asObject(change)?.path)).filter(Boolean).join("\n") || "변경된 파일";
}

function basename(path: string): string {
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").pop() || path || "Workspace";
}

function formatAge(value: string | number | null): string {
  if (value === null) return "시간 정보 없음";
  const timestamp = timestampMillis(value);
  if (Number.isNaN(timestamp)) return "시간 정보 없음";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}일 전` : new Date(timestamp).toLocaleDateString();
}

function effortLabel(value: string): string {
  const labels: Record<string, string> = {
    minimal: "최소",
    low: "낮음",
    medium: "보통",
    high: "높음",
    xhigh: "매우 높음",
    max: "최대",
    ultra: "울트라",
  };
  return labels[value] ?? value;
}

function permissionPresetLabel(profileId: string): string {
  return PERMISSION_PRESETS.find((preset) => preset.id === profileId)?.label ?? profileId;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function displayValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) return value.map((part) => String(part)).join(" ");
  return "(unavailable)";
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function targetDisplay(value: string): string {
  if (value === LOCAL_MOBILE_TARGET) return "로컬 host";
  if (!value.startsWith("hive+")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol + "//" + parsed.host + parsed.pathname;
  } catch {
    return "Hive TCP relay";
  }
}

function makeGtkTopbarStyle(settings: GtkSettings | null): CSSProperties {
  if (!settings) return {};
  const height = Math.max(36, Math.min(96, Math.round(settings.headerbar.height || 46)));
  return {
    "--gtk-header-fg": settings.headerbar.foreground,
    "--gtk-button-fg": settings.button.normal.foreground,
    "--gtk-button-bg": settings.button.normal.background,
    "--gtk-button-hover-fg": settings.button.hover.foreground,
    "--gtk-button-hover-bg": settings.button.hover.background,
    "--gtk-button-active-fg": settings.button.active.foreground,
    "--gtk-button-active-bg": settings.button.active.background,
    "--gtk-button-disabled-fg": settings.button.disabled.foreground,
    "--gtk-button-disabled-bg": settings.button.disabled.background,
    height: `${height}px`,
    minHeight: `${height}px`,
    backgroundColor: settings.headerbar.background,
    color: settings.headerbar.foreground,
    fontFamily: settings.gtk.fontFamily || undefined,
  } as CSSProperties;
}

function makeGtkControlStyle(settings: GtkSettings | null): CSSProperties {
  const spacing = Math.max(0, settings?.titleButtons.spacing ?? 3);
  return { "--gtk-titlebutton-spacing": `${spacing}px` } as CSSProperties;
}

function nativeWindowButtonStyle(raster?: GtkTitleButtonRaster): CSSProperties | undefined {
  if (!raster?.normal || raster.width <= 0 || raster.height <= 0) return undefined;
  return { width: `${raster.width}px`, height: `${raster.height}px` };
}

function Icon({ name }: { name: string }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    "panel-left": <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M9 4v16" /></>,
    "panel-right": <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M15 4v16" /></>,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    chevrons: <><path d="m7 10 5-5 5 5" /><path d="m7 14 5 5 5-5" /></>,
    folder: <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z" />,
    message: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2v-9.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z" /><path d="M8 11h8M8 14h5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2A1.7 1.7 0 0 0 7.8 17l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2A1.7 1.7 0 0 0 5.4 5.8l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2A1.7 1.7 0 0 0 17 3.4l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" transform="translate(1 1) scale(.9)" /></>,
    sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15ZM5 2l.7 1.8L7.5 4.5l-1.8.7L5 7l-.7-1.8-1.8-.7 1.8-.7L5 2Z" /></>,
    terminal: <><path d="m4 5 6 6-6 6" /><path d="M12 18h8" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    branch: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="6" cy="18" r="2" /><path d="M6 8v8M18 16v-2a6 6 0 0 0-6-6H8" /></>,
    history: <><path d="M3 12a9 9 0 1 0 2.7-6.4L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2" /></>,
    edit: <><path d="m14 5 5 5M4 20l4.5-1 10.7-10.7a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    files: <><path d="M14 2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
    "arrow-up": <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
    "window-minimize": <path d="M5 12h14" />,
    "window-maximize": <rect x="5" y="5" width="14" height="14" rx="1" />,
    "window-restore": <><path d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3" /><rect x="4" y="8" width="12" height="12" rx="1" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    "arrow-up-right": <><path d="M7 17 17 7M7 7h10v10" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    moon: <path d="M20.4 15.7A8.5 8.5 0 0 1 8.3 3.6 8.5 8.5 0 1 0 20.4 15.7Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
  };
  return <svg {...common}>{paths[name] ?? <circle cx="12" cy="12" r="8" />}</svg>;
}

function GtkWindowIcon({ source, fallback }: { source?: string; fallback: string }) {
  return source
    ? <img className="gtk-themed-icon" src={source} alt="" aria-hidden="true" />
    : <Icon name={fallback} />;
}

function GtkTitleButton({ raster, fallback }: { raster?: GtkTitleButtonRaster; fallback: string }) {
  if (!raster?.normal) return <Icon name={fallback} />;
  const style = {
    width: `${raster.width}px`,
    height: `${raster.height}px`,
    "--gtk-titlebutton-normal": `url("${raster.normal}")`,
    "--gtk-titlebutton-hover": `url("${raster.hover || raster.normal}")`,
    "--gtk-titlebutton-active": `url("${raster.active || raster.normal}")`,
    "--gtk-titlebutton-disabled": `url("${raster.disabled || raster.normal}")`,
  } as CSSProperties;
  return <span className="gtk-title-button" style={style} aria-hidden="true" />;
}
