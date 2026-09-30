import type { PointerEvent } from "react";

export type WindowResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type WindowResizeControls = {
  maximized: boolean;
  overlayOpen: boolean;
  begin: (event: PointerEvent<HTMLDivElement>, edge: WindowResizeEdge) => void | Promise<void>;
  move: (event: PointerEvent<HTMLDivElement>) => void;
  end: (event: PointerEvent<HTMLDivElement>) => void;
};

export const WINDOW_RESIZE_EDGES: WindowResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
