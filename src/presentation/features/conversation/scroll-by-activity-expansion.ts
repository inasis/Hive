import type { MouseEvent } from "react";

export function scrollByActivityExpansion(event: MouseEvent<HTMLElement>) {
  const details = event.currentTarget.parentElement;
  if (!(details instanceof HTMLDetailsElement) || details.open) return;
  const collapsedHeight = details.getBoundingClientRect().height;
  const scroll = details.closest<HTMLDivElement>(".conversation-scroll");
  requestAnimationFrame(() => {
    if (!details.open || !scroll) return;
    const expandedHeight = details.getBoundingClientRect().height - collapsedHeight;
    if (expandedHeight > 0) scroll.scrollBy({ top: expandedHeight, behavior: "smooth" });
  });
}
