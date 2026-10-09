import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP);

export type MountedUiMotionOptions = {
  rootRef: RefObject<HTMLDivElement | null>;
  reducedMotion: { current: boolean };
};

const MOUNT_SELECTOR = ".dialog-backdrop, .tab-create-menu, .slash-skill-menu, .window-menu-panel, .inline-notice, .user-entry, .assistant-entry, .tool-card, .change-summary, .activity-group, .skill-card, .session-row, .project-group, .feature-empty";

/** Animate UI elements when they enter the workspace DOM. */
export function useMountedUiMotion({ rootRef, reducedMotion }: MountedUiMotionOptions): void {
  useGSAP((_, contextSafe) => {
    const root = rootRef.current;
    if (!root) return;
    const animated = new WeakSet<Element>();
    const animateMounted = contextSafe!((element: Element) => {
      if (animated.has(element) || reducedMotion.current) return;
      animated.add(element);
      if (element.matches(".dialog-backdrop")) {
        gsap.fromTo(element, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "power2.out", overwrite: "auto" });
        const dialog = element.querySelector<HTMLElement>(".connect-dialog, .approval-dialog");
        if (dialog) gsap.fromTo(dialog, { autoAlpha: 0, y: 18, scale: 0.965 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.58, ease: "elastic.out(1, 0.54)", overwrite: "auto" });
        return;
      }
      if (element.matches(".tab-create-menu, .slash-skill-menu, .window-menu-panel")) {
        gsap.fromTo(element, { autoAlpha: 0, y: 9, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: "back.out(1.7)", overwrite: "auto" });
        return;
      }
      gsap.fromTo(element, { autoAlpha: 0, y: 10, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.44, ease: "back.out(1.45)", overwrite: "auto" });
    });

    const inspectNode = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(MOUNT_SELECTOR)) animateMounted(node);
      node.querySelectorAll(MOUNT_SELECTOR).forEach(animateMounted);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(inspectNode);
    });
    observer.observe(root, { childList: true, subtree: true });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, { scope: rootRef });
}
