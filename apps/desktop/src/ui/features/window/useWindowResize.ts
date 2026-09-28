import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { bridgeRpc } from "../../bridgeClient";
import type { WindowResizeEdge } from "./window-resize-types";

type WindowResizeState = {
  edge: WindowResizeEdge;
  pointerId: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  frame?: { x: number; y: number; width: number; height: number };
  scaleX?: number;
  scaleY?: number;
  sentX?: number;
  sentY?: number;
  inFlight: boolean;
  scheduled: boolean;
  released: boolean;
};

/** Own native frame resizing from pointer capture through the final queued frame update. */
export function useWindowResize(onNotice: (message: string) => void) {
  const windowResizeRef = useRef<WindowResizeState | null>(null);

  const scheduleWindowResize = useCallback(() => {
    const state = windowResizeRef.current;
    if (!state?.frame || state.inFlight || state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      const current = windowResizeRef.current;
      if (!current || current !== state) return;
      current.scheduled = false;
      const { frame, edge } = current;
      if (!frame) return;
      if (current.latestX === current.sentX && current.latestY === current.sentY) {
        if (current.released) windowResizeRef.current = null;
        return;
      }
      const dx = (current.latestX - current.startX) * (current.scaleX ?? 1);
      const dy = (current.latestY - current.startY) * (current.scaleY ?? 1);
      let { x, y, width, height } = frame;
      if (edge.includes("e")) width = Math.max(640, frame.width + dx);
      if (edge.includes("s")) height = Math.max(420, frame.height + dy);
      if (edge.includes("w")) {
        width = Math.max(640, frame.width - dx);
        x = frame.x + frame.width - width;
      }
      if (edge.includes("n")) {
        height = Math.max(420, frame.height - dy);
        y = frame.y + frame.height - height;
      }
      current.sentX = current.latestX;
      current.sentY = current.latestY;
      current.inFlight = true;
      void bridgeRpc.request.setWindowFrame({ x, y, width, height })
        .catch((error) => onNotice(errorMessage(error)))
        .finally(() => {
          current.inFlight = false;
          if (windowResizeRef.current === current) {
            if (current.latestX !== current.sentX || current.latestY !== current.sentY) scheduleWindowResize();
            else if (current.released) windowResizeRef.current = null;
          }
        });
    });
  }, [onNotice]);

  const beginWindowResize = useCallback(async (event: ReactPointerEvent<HTMLDivElement>, edge: WindowResizeEdge) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    const state: WindowResizeState = {
      edge,
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      latestX: event.screenX,
      latestY: event.screenY,
      sentX: event.screenX,
      sentY: event.screenY,
      inFlight: false,
      scheduled: false,
      released: false,
    };
    windowResizeRef.current = state;
    try {
      const result = await bridgeRpc.request.getWindowFrame({});
      if (windowResizeRef.current !== state) return;
      if (result.maximized) {
        windowResizeRef.current = null;
        return;
      }
      state.frame = result;
      state.scaleX = result.width / Math.max(1, window.innerWidth);
      state.scaleY = result.height / Math.max(1, window.innerHeight);
      scheduleWindowResize();
    } catch (error) {
      if (windowResizeRef.current === state) windowResizeRef.current = null;
      onNotice(errorMessage(error));
    }
  }, [onNotice, scheduleWindowResize]);

  const moveWindowResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = windowResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    state.latestX = event.screenX;
    state.latestY = event.screenY;
    scheduleWindowResize();
  }, [scheduleWindowResize]);

  const endWindowResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = windowResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    state.latestX = event.screenX;
    state.latestY = event.screenY;
    state.released = true;
    scheduleWindowResize();
    if (state.frame && !state.scheduled && !state.inFlight && state.latestX === state.sentX && state.latestY === state.sentY) {
      windowResizeRef.current = null;
    }
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }, [scheduleWindowResize]);

  return { beginWindowResize, moveWindowResize, endWindowResize };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
