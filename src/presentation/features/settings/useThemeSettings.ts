import { useEffect, useState } from "react";
import type { ThemeMode } from "./settings-types";
import { PREFERENCE_KEYS } from "../../shared/preferences";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

export function useThemeSettings() {
  const { bridge } = useDesktopUiRuntime();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const storedTheme = bridge.preferences.getItem(PREFERENCE_KEYS.theme);
    if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#000000" : "#FFFFFF");
    bridge.setAndroidStatusBarAppearance(theme === "light");
  }, [bridge, theme]);

  const toggleTheme = () => setTheme((current) => {
    const next = current === "dark" ? "light" : "dark";
    bridge.preferences.setItem(PREFERENCE_KEYS.theme, next);
    return next;
  });

  return { theme, setTheme, toggleTheme };
}
