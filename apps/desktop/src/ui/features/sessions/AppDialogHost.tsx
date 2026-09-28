import type { ComponentProps, PointerEvent } from "react";
import { NewSessionDialog } from "./NewSessionDialog";
import { SessionDialogs } from "./SessionDialogs";
import { WINDOW_RESIZE_EDGES, type WindowResizeEdge } from "../window/window-resize-types";

type AppDialogHostProps = {
  newSession: ComponentProps<typeof NewSessionDialog>;
  sessions: ComponentProps<typeof SessionDialogs>;
  windowResize: {
    maximized: boolean;
    overlayOpen: boolean;
    begin: (event: PointerEvent<HTMLDivElement>, edge: WindowResizeEdge) => void | Promise<void>;
    move: (event: PointerEvent<HTMLDivElement>) => void;
    end: (event: PointerEvent<HTMLDivElement>) => void;
  };
};

export function AppDialogHost({ newSession, sessions, windowResize }: AppDialogHostProps) {
  return <>
    <NewSessionDialog {...newSession} />
    <SessionDialogs {...sessions} />
    <div className="window-resize-grips" aria-hidden="true" hidden={windowResize.maximized || windowResize.overlayOpen}>
      {WINDOW_RESIZE_EDGES.map((edge) => <div
        key={edge}
        className={`window-resize-grip resize-${edge}`}
        onPointerDown={(event) => void windowResize.begin(event, edge)}
        onPointerMove={windowResize.move}
        onPointerUp={windowResize.end}
        onPointerCancel={windowResize.end}
      />)}
    </div>
  </>;
}
