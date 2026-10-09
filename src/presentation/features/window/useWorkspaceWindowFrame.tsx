import type { ReactNode } from "react";
import type { WindowChrome } from "../../shared/window-chrome";
import type { WindowResizeControls } from "../../shared/window-resize";
import type { ThemeMode } from "../settings/settings-types";
import { useWindowControls } from "./useWindowControls";
import { useWindowResize } from "./useWindowResize";

export function useWorkspaceWindowFrame({
  isLinuxDesktop,
  desktopSidebarCollapsed,
  theme,
  overlayOpen,
  onActivePage,
  onNotice,
  onDetectedTheme,
}: {
  isLinuxDesktop: boolean;
  desktopSidebarCollapsed: boolean;
  theme: ThemeMode;
  overlayOpen: boolean;
  onActivePage: (page: "sessions") => void;
  onNotice: (message: string) => void;
  onDetectedTheme: (theme: "dark" | "light") => void;
}): {
  windowChrome: WindowChrome;
  windowResize: WindowResizeControls;
  sidebarControls: { leftControls?: ReactNode; rightControls?: ReactNode };
} {
  const controls = useWindowControls({
    isLinuxDesktop,
    desktopSidebarCollapsed,
    theme,
    onActivePage,
    onNotice,
    onDetectedTheme,
  });
  const resize = useWindowResize(onNotice);

  return {
    windowChrome: {
      gtkSettings: controls.gtkSettings,
      gtkTopbarStyle: controls.gtkTopbarStyle,
      gtkControlStyle: controls.gtkControlStyle,
      topbarGtkLeftDecorations: controls.topbarGtkLeftDecorations,
      topbarGtkRightDecorations: controls.topbarGtkRightDecorations,
      renderGtkDecorations: controls.renderGtkDecorations,
      renderWindowsControls: controls.renderWindowsControls,
    },
    windowResize: {
      maximized: controls.windowMaximized,
      overlayOpen,
      begin: resize.beginWindowResize,
      move: resize.moveWindowResize,
      end: resize.endWindowResize,
    },
    sidebarControls: {
      leftControls: controls.sidebarGtkLeftDecorations.length > 0
        ? <div className="window-controls window-controls-left sidebar-window-controls electrobun-webkit-app-region-no-drag" style={controls.gtkControlStyle} aria-label="왼쪽 창 제어">{controls.renderGtkDecorations(controls.sidebarGtkLeftDecorations, "left")}</div>
        : undefined,
      rightControls: controls.sidebarGtkRightDecorations.length > 0
        ? <div className="window-controls window-controls-right sidebar-window-controls electrobun-webkit-app-region-no-drag" style={controls.gtkControlStyle} aria-label="오른쪽 창 제어">{controls.renderGtkDecorations(controls.sidebarGtkRightDecorations, "right")}</div>
        : undefined,
    },
  };
}
