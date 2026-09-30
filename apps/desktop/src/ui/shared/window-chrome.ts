import type { CSSProperties, ReactNode } from "react";
import type { GtkSettings } from "../../shared/bridge";

export type WindowChrome = {
  gtkSettings: GtkSettings | null;
  gtkTopbarStyle: CSSProperties;
  gtkControlStyle: CSSProperties;
  topbarGtkLeftDecorations: string[];
  topbarGtkRightDecorations: string[];
  renderGtkDecorations(items: string[], side: "left" | "right"): ReactNode[];
  renderWindowsControls(): ReactNode;
};
