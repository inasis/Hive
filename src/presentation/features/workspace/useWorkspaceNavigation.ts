import { useCallback, useState } from "react";
import type { AppPage, SettingsSection } from "../../shared/workspace-state";

export function useWorkspaceNavigation({
  initialPage,
}: {
  initialPage: AppPage;
}) {
  const [activePage, setActivePage] = useState<AppPage>(initialPage);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("connection");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  const openSettings = useCallback((section?: SettingsSection) => {
    setSettingsSection((current) => section ?? current);
    setActivePage("settings");
    closeMobileSidebar();
  }, [closeMobileSidebar]);

  const navigate = useCallback((page: AppPage) => {
    setActivePage(page);
    closeMobileSidebar();
  }, [closeMobileSidebar]);

  return {
    activePage,
    setActivePage,
    settingsSection,
    setSettingsSection,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    desktopSidebarCollapsed,
    setDesktopSidebarCollapsed,
    closeMobileSidebar,
    openSettings,
    navigate,
  };
}
