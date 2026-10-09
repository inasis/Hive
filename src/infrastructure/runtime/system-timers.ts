import type { TimerHandle, TimerPort } from "../../application/ports/timers.js";

type SystemTimerHandle = TimerHandle & { native: ReturnType<typeof globalThis.setTimeout> };

/** Implements application timers with the host Node.js runtime. */
export class SystemTimerAdapter implements TimerPort {
  schedule(callback: () => void, delayMs: number): TimerHandle {
    return { native: globalThis.setTimeout(callback, delayMs) };
  }

  cancel(timer: TimerHandle): void {
    globalThis.clearTimeout((timer as SystemTimerHandle).native);
  }
}
