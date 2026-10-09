import type { TimerHandle, TimerPort } from "../../../../src/application/ports/timers.js";

type BrowserTimerHandle = TimerHandle & { native: number };

/** Implements application timers with the desktop renderer's browser runtime. */
export class BrowserTimerAdapter implements TimerPort {
  schedule(callback: () => void, delayMs: number): TimerHandle {
    return { native: window.setTimeout(callback, delayMs) };
  }

  cancel(timer: TimerHandle): void {
    window.clearTimeout((timer as BrowserTimerHandle).native);
  }
}
