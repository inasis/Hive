import { useRef, type RefObject } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

export type WorkspacePageTransitionMotionOptions = {
  rootRef: RefObject<HTMLDivElement | null>;
  activePage: string;
  reducedMotion: { current: boolean };
};

/** Animate the content surface when switching workspace pages. */
export function useWorkspacePageTransitionMotion({ rootRef, activePage, reducedMotion }: WorkspacePageTransitionMotionOptions): void {
  const lastPage = useRef(activePage);
  useGSAP((_, contextSafe) => {
    const pageChanged = lastPage.current !== activePage;
    lastPage.current = activePage;
    if (!pageChanged || reducedMotion.current) return;
    const root = rootRef.current;
    const page = root?.querySelector<HTMLElement>(activePage === "sessions" ? ".content-row" : ".feature-page");
    if (page) contextSafe!(() => gsap.fromTo(page, { autoAlpha: 0.72, y: 9 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "back.out(1.45)", overwrite: "auto" }))();
  }, { dependencies: [activePage], scope: rootRef, revertOnUpdate: true });
}
