import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceFileOpenRequest, WorkspaceFileTab, WorkspaceTab } from "../../shared/workspace-state";
import type { WorkspaceFileText } from "../../../shared/bridge";

export function useWorkspaceTabs({
  target,
  cwd,
  isMobileApp,
  isWideLayout,
  closeMobileSidebar,
}: {
  target: string;
  cwd: string;
  isMobileApp: boolean;
  isWideLayout: boolean;
  closeMobileSidebar: () => void;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("chat");
  const [terminalContexts, setTerminalContexts] = useState<Record<string, { target: string; cwd: string }>>({});
  const terminalContext = terminalContexts[target] ?? null;
  const setTerminalContext = (context: { target: string; cwd: string } | null) => setTerminalContexts((current) => {
    if (context) return { ...current, [context.target]: context };
    const next = { ...current }; delete next[target]; return next;
  });
  const [tabCreateMenuOpen, setTabCreateMenuOpen] = useState(false);
  const [tabCreateMenuPosition, setTabCreateMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [allWorkspaceFileTabs, setWorkspaceFileTabs] = useState<WorkspaceFileTab[]>([]);
  const workspaceFileTabs = allWorkspaceFileTabs.filter((tab) => tab.target === target);
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [filePanelInitialized, setFilePanelInitialized] = useState(false);
  const [workspaceFileOpenRequest, setWorkspaceFileOpenRequest] = useState<WorkspaceFileOpenRequest | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([]);
  const filesPanelRef = useRef<HTMLElement>(null);
  const tabCreateMenuRef = useRef<HTMLDivElement>(null);
  const tabCreateButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceFileOpenSequence = useRef(0);

  const activeFileTabId = activeTab.startsWith("file:") ? activeTab.slice("file:".length) : "";
  const activeFileTab = workspaceFileTabs.find((tab) => tab.id === activeFileTabId) ?? null;

  const openWorkspaceMarkdownFile = useCallback((path: string) => {
    if (!target || !cwd) return;
    const id = ++workspaceFileOpenSequence.current;
    setWorkspaceFileOpenRequest({ id, target, cwd, path });
    setFilePanelInitialized(true);
    setFilePanelOpen(true);
  }, [target, cwd]);

  const openWorkspaceFileTab = useCallback((fileTarget: string, fileCwd: string, file: WorkspaceFileText) => {
    const id = `${fileTarget}\0${fileCwd}\0${file.path}`;
    setWorkspaceFileTabs((current) => {
      const existingIndex = current.findIndex((tab) => tab.id === id);
      if (existingIndex < 0) return [...current, { id, target: fileTarget, cwd: fileCwd, file }];
      const next = [...current];
      next[existingIndex] = { id, target: fileTarget, cwd: fileCwd, file };
      return next;
    });
    setActiveTab(`file:${id}`);
    if (isMobileApp || window.matchMedia("(max-width: 900px)").matches) setFilePanelOpen(false);
  }, [isMobileApp]);

  const handleWorkspaceFileOpenHandled = useCallback((id: number) => {
    setWorkspaceFileOpenRequest((current) => current?.id === id ? null : current);
  }, []);

  useEffect(() => {
    if (!tabCreateMenuOpen) return;
    const dismissMenu = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (!(eventTarget instanceof Node)) return;
      if (!tabCreateMenuRef.current?.contains(eventTarget) && !tabCreateButtonRef.current?.contains(eventTarget)) setTabCreateMenuOpen(false);
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

  const openTerminalTab = () => {
    if (terminalContext || !target || !cwd) return;
    setTerminalContext({ target, cwd });
    setActiveTab("terminal");
    setTabCreateMenuOpen(false);
  };

  const closeTerminalTab = () => {
    setTerminalContext(null);
    if (activeTab === "terminal") setActiveTab("chat");
  };

  const toggleProject = (key: string) => setCollapsedProjects((current) =>
    current.includes(key) ? current.filter((project) => project !== key) : [...current, key],
  );

  const toggleFilePanel = () => {
    const nextOpen = !filePanelOpen;
    if (isMobileApp && !isWideLayout && nextOpen) closeMobileSidebar();
    setFilePanelInitialized(true);
    setFilePanelOpen(nextOpen);
  };

  const closeWorkspaceFileTab = (id: string) => {
    const index = workspaceFileTabs.findIndex((tab) => tab.id === id);
    const remaining = workspaceFileTabs.filter((tab) => tab.id !== id);
    const nextTab = remaining[index] ?? remaining[index - 1];
    setWorkspaceFileTabs((current) => current.filter((tab) => tab.id !== id));
    if (activeTab === `file:${id}`) setActiveTab(nextTab ? `file:${nextTab.id}` : terminalContext ? "terminal" : "chat");
  };

  return {
    activeTab,
    setActiveTab,
    activeFileTab,
    terminalContext,
    terminalContexts: Object.values(terminalContexts),
    setTerminalContext,
    tabCreateMenuOpen,
    setTabCreateMenuOpen,
    tabCreateMenuPosition,
    tabCreateMenuRef,
    tabCreateButtonRef,
    toggleTabCreateMenu,
    workspaceFileTabs,
    filePanelOpen,
    setFilePanelOpen,
    filePanelInitialized,
    setFilePanelInitialized,
    workspaceFileOpenRequest,
    setWorkspaceFileOpenRequest,
    filesPanelRef,
    collapsedProjects,
    openWorkspaceMarkdownFile,
    openWorkspaceFileTab,
    handleWorkspaceFileOpenHandled,
    openTerminalTab,
    closeTerminalTab,
    toggleProject,
    toggleFilePanel,
    closeWorkspaceFileTab,
  };
}
