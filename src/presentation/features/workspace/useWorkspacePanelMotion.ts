import { useRef, type RefObject } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

export type WorkspacePanelMotionOptions = {
  rootRef: RefObject<HTMLDivElement | null>;
  sidebarRef: RefObject<HTMLElement | null>;
  filesPanelRef: RefObject<HTMLElement | null>;
  reducedMotion: { current: boolean };
  desktopSidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  filePanelInitialized: boolean;
  filePanelOpen: boolean;
  activePage: string;
  isMobileApp: boolean;
  isWideLayout: boolean;
};

function naturalWidth(element: HTMLElement): number {
  const inlineWidth = element.style.width;
  element.style.removeProperty("width");
  const width = Number.parseFloat(getComputedStyle(element).width) || element.getBoundingClientRect().width;
  if (inlineWidth) element.style.width = inlineWidth;
  return width;
}

function animateMobileDrawer(element: HTMLElement, open: boolean, side: "left" | "right"): void {
  const closedPercent = side === "left" ? -110 : 110;
  element.style.setProperty("--drawer-edge-fill", "10%");
  element.dataset.drawerMotion = "true";
  const clearEdgeFill = () => {
    element.style.removeProperty("--drawer-edge-fill");
    delete element.dataset.drawerMotion;
  };
  if (open) {
    gsap.fromTo(element, { xPercent: closedPercent }, {
      xPercent: 0,
      duration: 0.5,
      ease: "elastic.out(0.45, 0.9)",
      overwrite: "auto",
      onComplete: clearEdgeFill,
    });
    return;
  }
  gsap.to(element, {
    xPercent: closedPercent,
    duration: 0.34,
    ease: "back.in(1.05)",
    overwrite: "auto",
    onComplete: clearEdgeFill,
  });
}

/** Animate the workspace sidebar and file panel across desktop and mobile layouts. */
export function useWorkspacePanelMotion({
  rootRef,
  sidebarRef,
  filesPanelRef,
  reducedMotion,
  desktopSidebarCollapsed,
  mobileSidebarOpen,
  filePanelInitialized,
  filePanelOpen,
  activePage,
  isMobileApp,
  isWideLayout,
}: WorkspacePanelMotionOptions): void {
  const lastDesktopCollapse = useRef(false);
  useGSAP((_, contextSafe) => {
    const sidebar = sidebarRef.current;
    const shouldCollapse = desktopSidebarCollapsed && (!isMobileApp || isWideLayout);
    const wasCollapsed = lastDesktopCollapse.current;
    lastDesktopCollapse.current = shouldCollapse;
    if (!sidebar) return;
    gsap.killTweensOf(sidebar, "width,flexBasis,borderRightWidth");
    if (!isMobileApp || isWideLayout) {
      if (shouldCollapse === wasCollapsed) return;
      const width = naturalWidth(sidebar);
      if (reducedMotion.current) {
        if (shouldCollapse) gsap.set(sidebar, { width: 0, flexBasis: 0, borderRightWidth: 0 });
        else gsap.set(sidebar, { clearProps: "width,flexBasis,borderRightWidth" });
      } else if (shouldCollapse) {
        contextSafe!(() => gsap.fromTo(sidebar, { width, flexBasis: width, borderRightWidth: 1 }, { width: 0, flexBasis: 0, borderRightWidth: 0, duration: 0.48, ease: "back.in(1.15)", overwrite: "auto" }))();
      } else {
        contextSafe!(() => gsap.fromTo(sidebar, { width: 0, flexBasis: 0, borderRightWidth: 0 }, { width, flexBasis: width, borderRightWidth: 1, duration: 0.62, ease: "elastic.out(1, 0.56)", overwrite: "auto", onComplete: () => gsap.set(sidebar, { clearProps: "width,flexBasis,borderRightWidth" }) }))();
      }
    } else {
      gsap.set(sidebar, { clearProps: "width,flexBasis,borderRightWidth" });
    }
  }, { dependencies: [desktopSidebarCollapsed, isMobileApp, isWideLayout], scope: rootRef, revertOnUpdate: true });

  const lastMobileDrawer = useRef<{ mode: boolean; open: boolean } | null>(null);
  useGSAP((_, contextSafe) => {
    const sidebar = sidebarRef.current;
    const isMobileDrawer = isMobileApp && !isWideLayout;
    const previous = lastMobileDrawer.current;
    lastMobileDrawer.current = { mode: isMobileDrawer, open: isMobileDrawer && mobileSidebarOpen };
    if (!sidebar) return;
    gsap.killTweensOf(sidebar, "x,xPercent");
    sidebar.style.removeProperty("--drawer-edge-fill");
    delete sidebar.dataset.drawerMotion;
    if (!isMobileDrawer) {
      gsap.set(sidebar, { clearProps: "x,xPercent,transform" });
      return;
    }
    const isOpen = mobileSidebarOpen;
    if (reducedMotion.current || !previous || !previous.mode) {
      gsap.set(sidebar, { x: 0, xPercent: isOpen ? 0 : -110 });
    } else if (isOpen !== previous.open) {
      contextSafe!(() => animateMobileDrawer(sidebar, isOpen, "left"))();
    }
  }, { dependencies: [mobileSidebarOpen, isMobileApp, isWideLayout], scope: rootRef, revertOnUpdate: true });

  const lastFilePanel = useRef({ open: false, mobileDrawer: false });
  useGSAP((_, contextSafe) => {
    const panel = filesPanelRef.current;
    const mobileDrawer = isMobileApp && !isWideLayout;
    const open = filePanelInitialized && filePanelOpen && activePage === "sessions";
    const previous = lastFilePanel.current;
    lastFilePanel.current = { open, mobileDrawer };
    if (!panel) return;
    gsap.killTweensOf(panel, "width,flexBasis,borderLeftWidth,x,xPercent");
    panel.style.removeProperty("--drawer-edge-fill");
    delete panel.dataset.drawerMotion;
    if (mobileDrawer) {
      gsap.set(panel, { clearProps: "width,flexBasis,borderLeftWidth" });
      if (reducedMotion.current || (!open && !previous.open)) gsap.set(panel, { x: 0, xPercent: open ? 0 : 110 });
      else if (open !== previous.open || mobileDrawer !== previous.mobileDrawer) {
        contextSafe!(() => animateMobileDrawer(panel, open, "right"))();
      }
      return;
    }

    gsap.set(panel, { clearProps: "x,xPercent,transform" });
    const width = naturalWidth(panel);
    if (reducedMotion.current) {
      if (open) gsap.set(panel, { clearProps: "width,flexBasis,borderLeftWidth" });
      else gsap.set(panel, { width: 0, flexBasis: 0, borderLeftWidth: 0 });
    } else if (!open && !previous.open) {
      gsap.set(panel, { width: 0, flexBasis: 0, borderLeftWidth: 0 });
    } else if (open !== previous.open || mobileDrawer !== previous.mobileDrawer) {
      contextSafe!(() => gsap.fromTo(panel, { width: open ? 0 : width, flexBasis: open ? 0 : width, borderLeftWidth: open ? 0 : 1 }, { width: open ? width : 0, flexBasis: open ? width : 0, borderLeftWidth: open ? 1 : 0, duration: open ? 0.62 : 0.42, ease: open ? "elastic.out(1, 0.56)" : "back.in(1.2)", overwrite: "auto", onComplete: () => { if (open) gsap.set(panel, { clearProps: "width,flexBasis,borderLeftWidth" }); } }))();
    }
  }, { dependencies: [filePanelInitialized, filePanelOpen, activePage, isMobileApp, isWideLayout], scope: rootRef, revertOnUpdate: true });
}
