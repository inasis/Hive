import { useEffect, useRef, useState } from "react";
import type { WorkspaceTab } from "../../shared/workspace-state";
import { useWorkspaceFileTabs } from "./useWorkspaceFileTabs";

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
  const tabCreateMenuRef = useRef<HTMLDivElement>(null);
  const tabCreateButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceFileTabsState = useWorkspaceFileTabs({
    target,
    cwd,
    isMobileApp,
    isWideLayout,
    closeMobileSidebar,
    activeTab,
    setActiveTab,
    terminalContext,
  });

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

  return {
    activeTab,
    setActiveTab,
    ...workspaceFileTabsState,
    terminalContext,
    terminalContexts: Object.values(terminalContexts),
    setTerminalContext,
    tabCreateMenuOpen,
    setTabCreateMenuOpen,
    tabCreateMenuPosition,
    tabCreateMenuRef,
    tabCreateButtonRef,
    toggleTabCreateMenu,
    openTerminalTab,
    closeTerminalTab,
  };
}
