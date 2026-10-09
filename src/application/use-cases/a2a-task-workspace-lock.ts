import type { A2AWorkspaceLockPort } from "../ports/a2a-runtime.js";
import { raceWithAbort } from "../validation/a2a-abort-race.js";
import type { TimerPort } from "../ports/timers.js";

export type A2ATaskWorkspaceLockWaitResult =
  | { kind: "acquired"; release: () => void }
  | { kind: "timed-out" }
  | { kind: "cancelled" };

/** Applies a task deadline and cancellation signal while waiting for a workspace lock. */
export class A2ATaskWorkspaceLock {
  constructor(private readonly locks: A2AWorkspaceLockPort, private readonly timers: TimerPort) {}

  async wait(
    workspace: string,
    signal: AbortSignal,
    timeoutMs: number | undefined,
    onTimeout: () => void,
  ): Promise<A2ATaskWorkspaceLockWaitResult> {
    let timedOut = false;
    const timeout = timeoutMs === undefined ? undefined : this.timers.schedule(() => {
      timedOut = true;
      onTimeout();
    }, timeoutMs);
    const lockPromise = this.locks.acquire(workspace, signal);
    try {
      const release = await raceWithAbort(lockPromise, signal, () => timedOut);
      return { kind: "acquired", release };
    } catch {
      // A lock granted concurrently with cancellation must not remain held.
      void lockPromise.then((release) => release(), () => undefined);
      return { kind: timedOut ? "timed-out" : "cancelled" };
    } finally {
      if (timeout !== undefined) this.timers.cancel(timeout);
    }
  }
}
