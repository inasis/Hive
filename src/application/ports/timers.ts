/** Opaque handle returned by an application timer implementation. */
export type TimerHandle = object;

/** Schedules callbacks without exposing a runtime-specific timer API to Application. */
export interface TimerPort {
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(timer: TimerHandle): void;
}
