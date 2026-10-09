import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "../../shared/Icon";
import { PREFERENCE_KEYS } from "../../shared/preferences";
import type { GtkSettings, GtkTitleButtonRaster } from "../../shared/bridge";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";
import type { ThemeMode } from "../settings/settings-types";

const FALLBACK_DECORATION_LAYOUT = { layout: "menu:minimize,maximize,close", left: ["menu"], right: ["minimize", "maximize", "close"] };

export function useWindowControls({
  isLinuxDesktop,
  desktopSidebarCollapsed,
  theme,
  onActivePage,
  onNotice,
  onDetectedTheme,
}: {
  isLinuxDesktop: boolean;
  desktopSidebarCollapsed: boolean;
  theme: ThemeMode;
  onActivePage: (page: "sessions") => void;
  onNotice: (message: string) => void;
  onDetectedTheme: (theme: "dark" | "light") => void;
}) {
  const { bridge, renderDesktopWindowControls } = useDesktopUiRuntime();
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [windowFocused, setWindowFocused] = useState(() => typeof document === "undefined" || document.hasFocus());
  const [gtkSettings, setGtkSettings] = useState<GtkSettings | null>(null);
  const [gtkMenuOpen, setGtkMenuOpen] = useState(false);

  useEffect(() => {
    if (!isLinuxDesktop) return;
    let active = true;
    let receivedFocusEvent = false;
    const unsubscribe = bridge.subscribeWindowFocus((focused) => {
      receivedFocusEvent = true;
      setWindowFocused(focused);
    });
    void bridge.bridgeRpc.request.getWindowFocus({})
      .then(({ focused }) => {
        if (active && !receivedFocusEvent) setWindowFocused(focused);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, isLinuxDesktop]);

  useEffect(() => {
    if (!isLinuxDesktop) return;
    void bridge.bridgeRpc.request.windowAction({ action: "state" })
      .then((result) => setWindowMaximized(result.maximized))
      .catch(() => {});
  }, [bridge, isLinuxDesktop]);

  useEffect(() => {
    if (!isLinuxDesktop) return;
    let active = true;
    void bridge.bridgeRpc.request.getGtkSettings({ dark: theme === "dark" })
      .then((settings) => {
        if (!active) return;
        setGtkSettings(settings);
        if (bridge.preferences.getItem(PREFERENCE_KEYS.theme) === null) onDetectedTheme(settings.gtk.dark ? "dark" : "light");
      })
      .catch(() => {});
    return () => { active = false; };
  }, [bridge, isLinuxDesktop, onDetectedTheme, theme]);

  const controlWindow = useCallback(async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const result = await bridge.bridgeRpc.request.windowAction({ action });
      setWindowMaximized(result.maximized);
    } catch (error) {
      onNotice(errorMessage(error));
    }
  }, [bridge, onNotice]);

  const gtkTopbarStyle = useMemo(() => makeGtkTopbarStyle(gtkSettings), [gtkSettings]);
  const gtkControlStyle = useMemo(() => makeGtkControlStyle(gtkSettings), [gtkSettings]);
  const decorationLayout = gtkSettings?.window.decorationLayout ?? FALLBACK_DECORATION_LAYOUT;
  const moveGtkTitleButtonsToSidebar = isLinuxDesktop && !desktopSidebarCollapsed;
  const sidebarGtkLeftDecorations = moveGtkTitleButtonsToSidebar ? decorationLayout.left.filter(isGtkTitleButtonDecoration) : [];
  const sidebarGtkRightDecorations = moveGtkTitleButtonsToSidebar ? decorationLayout.right.filter(isGtkTitleButtonDecoration) : [];
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
        <button type="button" role="menuitem" onClick={() => { onActivePage("sessions"); setGtkMenuOpen(false); }}>작업 공간</button>
      </div>}
    </div>;
    if (item === "minimize") {
      const raster = gtkSettings?.titleButtons.minimize;
      return <button className={raster?.normal ? "window-control window-control-native" : "window-control"} style={nativeWindowButtonStyle(raster)} key={key} type="button" aria-label="최소화" title="최소화" onClick={() => void controlWindow("minimize")}><GtkTitleButton raster={raster} backdrop={!windowFocused} fallback="window-minimize" /></button>;
    }
    if (item === "maximize") {
      const raster = gtkSettings?.titleButtons[windowMaximized ? "restore" : "maximize"];
      return <button className={raster?.normal ? "window-control window-control-native" : "window-control"} style={nativeWindowButtonStyle(raster)} key={key} type="button" aria-label={windowMaximized ? "복원" : "최대화"} title={windowMaximized ? "복원" : "최대화"} onClick={() => void controlWindow("toggleMaximize")}><GtkTitleButton raster={raster} backdrop={!windowFocused} fallback={windowMaximized ? "window-restore" : "window-maximize"} /></button>;
    }
    if (item === "close") {
      const raster = gtkSettings?.titleButtons.close;
      return <button className={raster?.normal ? "window-control window-control-native" : "window-control"} style={nativeWindowButtonStyle(raster)} key={key} type="button" aria-label="닫기" title="닫기" onClick={() => void controlWindow("close")}><GtkTitleButton raster={raster} backdrop={!windowFocused} fallback="close" /></button>;
    }
    return null;
  });

  const renderWindowsControls = () => renderDesktopWindowControls?.(onNotice) ?? null;

  return {
    windowMaximized,
    gtkSettings,
    gtkTopbarStyle,
    gtkControlStyle,
    sidebarGtkLeftDecorations,
    sidebarGtkRightDecorations,
    topbarGtkLeftDecorations,
    topbarGtkRightDecorations,
    renderGtkDecorations,
    renderWindowsControls,
  };
}

function isGtkTitleButtonDecoration(item: string): boolean {
  return item === "minimize" || item === "maximize" || item === "close";
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

function GtkWindowIcon({ source, fallback }: { source?: string; fallback: IconName }) {
  return source ? <img className="gtk-themed-icon" src={source} alt="" aria-hidden="true" /> : <Icon name={fallback} />;
}

function GtkTitleButton({ raster, backdrop, fallback }: { raster?: GtkTitleButtonRaster; backdrop: boolean; fallback: IconName }) {
  if (!raster?.normal) return <Icon name={fallback} />;
  const states = backdrop ? raster.backdrop : raster;
  const style = {
    width: `${raster.width}px`,
    height: `${raster.height}px`,
    "--gtk-titlebutton-normal": `url("${states.normal || raster.normal}")`,
    "--gtk-titlebutton-hover": `url("${states.hover || states.normal || raster.normal}")`,
    "--gtk-titlebutton-active": `url("${states.active || states.normal || raster.normal}")`,
    "--gtk-titlebutton-disabled": `url("${states.disabled || states.normal || raster.normal}")`,
  } as CSSProperties;
  return <span className="gtk-title-button" style={style} aria-hidden="true" />;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
