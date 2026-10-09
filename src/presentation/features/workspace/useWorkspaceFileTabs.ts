import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { WorkspaceFileOpenRequest, WorkspaceFileTab, WorkspaceTab } from "../../shared/workspace-state";
import type { WorkspaceFileText } from "../../shared/bridge";

type WorkspaceFileTabsOptions = {
  target: string;
  cwd: string;
  isMobileApp: boolean;
  isWideLayout: boolean;
  closeMobileSidebar(): void;
  activeTab: WorkspaceTab;
  setActiveTab: Dispatch<SetStateAction<WorkspaceTab>>;
  terminalContext: { target: string; cwd: string } | null;
};

/** Own workspace file tabs, open requests, and file panel state. */
export function useWorkspaceFileTabs({
  target,
  cwd,
  isMobileApp,
  isWideLayout,
  closeMobileSidebar,
  activeTab,
  setActiveTab,
  terminalContext,
}: WorkspaceFileTabsOptions) {
  const [allWorkspaceFileTabs, setWorkspaceFileTabs] = useState<WorkspaceFileTab[]>([]);
  const workspaceFileTabs = allWorkspaceFileTabs.filter((tab) => tab.target === target);
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [filePanelInitialized, setFilePanelInitialized] = useState(false);
  const [workspaceFileOpenRequest, setWorkspaceFileOpenRequest] = useState<WorkspaceFileOpenRequest | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([]);
  const filesPanelRef = useRef<HTMLElement>(null);
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
  }, [isMobileApp, setActiveTab]);

  const handleWorkspaceFileOpenHandled = useCallback((id: number) => {
    setWorkspaceFileOpenRequest((current) => current?.id === id ? null : current);
  }, []);

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
    activeFileTab,
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
    toggleProject,
    toggleFilePanel,
    closeWorkspaceFileTab,
  };
}
