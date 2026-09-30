import { useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { FilesPanel } from "./FilesPanel";
import { Icon } from "../../shared/Icon";
import { useSpringUiMotion } from "../../useSpringUiMotion";
import type { WindowChrome } from "../../shared/window-chrome";
import { WINDOW_RESIZE_EDGES, type WindowResizeControls } from "../../shared/window-resize";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import type { AppPage, SettingsSection } from "../../shared/workspace-state";

type SidebarProps = ComponentProps<typeof WorkspaceSidebar>;

type WorkspaceFrameProps = {
  layout: {
    activePage: AppPage;
    settingsSection: SettingsSection;
    activeTitle: string;
    mobileSidebarOpen: boolean;
    desktopSidebarCollapsed: boolean;
    isMobileApp: boolean;
    isWindowsDesktop: boolean;
    isWideLayout: boolean;
    isLinuxDesktop: boolean;
    filePanelOpen: boolean;
    filePanelInitialized: boolean;
  };
  actions: {
    toggleSidebar: () => void;
    dismissMobilePanels: () => void;
    toggleFilePanel: () => void;
  };
  sidebar: Omit<SidebarProps, "asideRef" | "layout"> & {
    layout: Omit<SidebarProps["layout"], "sidebarA11yHidden">;
  };
  windowChrome: WindowChrome;
  windowResize: WindowResizeControls;
  filesPanel: {
    ref: RefObject<HTMLElement | null>;
    panel: ComponentProps<typeof FilesPanel>;
  };
  children: ReactNode;
  overlays: ReactNode;
};

export function WorkspaceFrame({ layout, actions, sidebar, windowChrome, windowResize, filesPanel, children, overlays }: WorkspaceFrameProps) {
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarA11yHidden = (layout.desktopSidebarCollapsed && (!layout.isMobileApp || layout.isWideLayout)) || (layout.isMobileApp && !layout.isWideLayout && !layout.mobileSidebarOpen);
  const narrowMobileDrawerOpen = layout.isMobileApp && !layout.isWideLayout && (layout.mobileSidebarOpen || (layout.activePage === "sessions" && layout.filePanelOpen));
  const settingsPageClass = layout.activePage === "settings" ? `settings-section-${layout.settingsSection}` : "";
  const sidebarToggleLabel = layout.isMobileApp && !layout.isWideLayout
    ? layout.mobileSidebarOpen ? "작업 공간 닫기" : "작업 공간 열기"
    : layout.desktopSidebarCollapsed ? "작업 공간 펼치기" : "작업 공간 접기";

  useSpringUiMotion({
    rootRef: appShellRef,
    sidebarRef,
    filesPanelRef: filesPanel.ref,
    desktopSidebarCollapsed: layout.desktopSidebarCollapsed,
    mobileSidebarOpen: layout.mobileSidebarOpen,
    filePanelInitialized: layout.filePanelInitialized,
    filePanelOpen: layout.filePanelOpen,
    activePage: layout.activePage,
    isMobileApp: layout.isMobileApp,
    isWideLayout: layout.isWideLayout,
  });

  return <div ref={appShellRef} className={`app-shell page-${layout.activePage} ${settingsPageClass} ${layout.isMobileApp ? "mobile-app" : ""} ${layout.isLinuxDesktop ? "linux-desktop" : ""} ${layout.isWindowsDesktop ? "windows-desktop" : ""} ${layout.desktopSidebarCollapsed ? "desktop-sidebar-collapsed" : ""}`}>
    {layout.isMobileApp && !layout.isWideLayout && <button className={`mobile-drawer-backdrop ${narrowMobileDrawerOpen ? "is-open" : ""}`} onClick={actions.dismissMobilePanels} aria-label="패널 닫기" aria-hidden={!narrowMobileDrawerOpen} inert={!narrowMobileDrawerOpen} />}
    <WorkspaceSidebar {...sidebar} asideRef={sidebarRef} layout={{
      ...sidebar.layout,
      sidebarA11yHidden,
    }} />

    <main className="main-column">
      <header className="topbar electrobun-webkit-app-region-drag" style={windowChrome.gtkTopbarStyle} data-gtk-theme={windowChrome.gtkSettings?.gtk.theme} data-gtk-icon-theme={windowChrome.gtkSettings?.gtk.iconTheme}>
        <div className="topbar-leading">
          {layout.isLinuxDesktop && windowChrome.topbarGtkLeftDecorations.length > 0 && <div className="window-controls window-controls-left electrobun-webkit-app-region-no-drag" style={windowChrome.gtkControlStyle} aria-label="왼쪽 창 제어">
            {windowChrome.renderGtkDecorations(windowChrome.topbarGtkLeftDecorations, "left")}
          </div>}
          <div className="breadcrumbs">
            <button className="desktop-sidebar-toggle-button electrobun-webkit-app-region-no-drag" type="button" onClick={actions.toggleSidebar} aria-label={sidebarToggleLabel} aria-controls="workspace-sidebar" aria-expanded={layout.isMobileApp && !layout.isWideLayout ? layout.mobileSidebarOpen : !layout.desktopSidebarCollapsed} title={sidebarToggleLabel}><Icon name="panel-left" /></button>
            <b>{layout.activePage === "sessions" ? layout.activeTitle || "작업 공간" : settingsSectionTitle(layout.settingsSection)}</b>
          </div>
        </div>
        <div className="topbar-actions electrobun-webkit-app-region-no-drag">
          {layout.activePage === "sessions" && <button className={`icon-button file-panel-toggle ${layout.filePanelOpen ? "active" : ""}`} type="button" aria-label={layout.filePanelOpen ? "파일 패널 닫기" : "파일 패널 열기"} aria-pressed={layout.filePanelOpen} title={layout.filePanelOpen ? "파일 패널 닫기" : "파일 패널 열기"} onClick={actions.toggleFilePanel}><Icon name="panel-right" /></button>}
          {layout.isWindowsDesktop && <div className="window-controls windows-window-controls" aria-label="창 제어">{windowChrome.renderWindowsControls()}</div>}
          {layout.isLinuxDesktop && windowChrome.topbarGtkRightDecorations.length > 0 && <div className="window-controls window-controls-right" style={windowChrome.gtkControlStyle} aria-label="오른쪽 창 제어">
            {windowChrome.renderGtkDecorations(windowChrome.topbarGtkRightDecorations, "right")}
          </div>}
        </div>
      </header>
      {children}
    </main>

    {layout.activePage === "sessions" && layout.filePanelInitialized && <aside ref={filesPanel.ref} className={`files-side-panel ${layout.filePanelOpen ? "" : "file-panel-closed"}`} aria-label="파일 패널" aria-hidden={!layout.filePanelOpen} inert={!layout.filePanelOpen}>
      <FilesPanel {...filesPanel.panel} />
    </aside>}
    {!layout.isMobileApp && <div className="window-resize-grips" aria-hidden="true" hidden={windowResize.maximized || windowResize.overlayOpen}>
      {WINDOW_RESIZE_EDGES.map((edge) => <div
        key={edge}
        className={`window-resize-grip resize-${edge}`}
        onPointerDown={(event) => void windowResize.begin(event, edge)}
        onPointerMove={windowResize.move}
        onPointerUp={windowResize.end}
        onPointerCancel={windowResize.end}
      />)}
    </div>}
    {overlays}
  </div>;
}

function settingsSectionTitle(section: SettingsSection): string {
  switch (section) {
    case "connection": return "연결";
    case "skills": return "스킬";
    case "mcp": return "MCP";
    case "theme": return "테마";
  }
}
