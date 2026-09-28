import { useEffect, useState } from "react";

export function useResponsiveWorkspaceLayout(isMobileApp: boolean): boolean {
  const [isWideLayout, setIsWideLayout] = useState(() => window.matchMedia("(min-width: 681px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 681px)");
    const update = () => setIsWideLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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
  }, [isMobileApp]);

  return isWideLayout;
}
