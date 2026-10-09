import type {
  ProviderRestoreSignalsPort,
} from "../../../../src/application/ports/prompt-recovery.js";
import type { TimerHandle, TimerPort } from "../../../../src/application/ports/timers.js";
import type { AssistantProvider } from "../../../../src/domain/provider-catalog.js";

type RestoreState = { version: number; outcome: "ready" } | { version: number; outcome: "failed"; message: string };
type RestoreOutcome = { outcome: "ready" } | { outcome: "failed"; message: string };
type RestoreWaiter = {
  afterVersion: number;
  resolve(): void;
  reject(error: Error): void;
  timer: TimerHandle;
};

/** Stores per-daemon/provider restore signals and applies the desktop timeout mechanism. */
export class ProviderRestoreSignals implements ProviderRestoreSignalsPort {
  private readonly states = new Map<string, RestoreState>();
  private readonly waiters = new Map<string, Set<RestoreWaiter>>();

  constructor(private readonly timers: TimerPort) {}

  currentVersion(target: string, provider: AssistantProvider): number {
    return this.states.get(restoreKey(target, provider))?.version ?? 0;
  }

  markRestored(target: string, provider: AssistantProvider): void {
    this.update(target, provider, { outcome: "ready" });
  }

  markFailed(target: string, provider: AssistantProvider, message: string): void {
    this.update(target, provider, { outcome: "failed", message });
  }

  waitForRestore(target: string, provider: AssistantProvider, afterVersion: number, timeoutMs: number): Promise<void> {
    const key = restoreKey(target, provider);
    const current = this.states.get(key);
    if (current && current.version > afterVersion) {
      return current.outcome === "ready" ? Promise.resolve() : Promise.reject(new Error(current.message));
    }

    return new Promise((resolve, reject) => {
      const waiters = this.waiters.get(key) ?? new Set<RestoreWaiter>();
      let waiter: RestoreWaiter;
      const timer = this.timers.schedule(() => {
        waiters.delete(waiter);
        if (waiters.size === 0) this.waiters.delete(key);
        reject(new Error("Hive 데몬 연결은 복구됐지만 provider 세션 준비를 기다리는 시간이 초과됐습니다."));
      }, timeoutMs);
      waiter = { afterVersion, resolve, reject, timer };
      waiters.add(waiter);
      this.waiters.set(key, waiters);
    });
  }

  private update(target: string, provider: AssistantProvider, outcomeValue: RestoreOutcome): void {
    const key = restoreKey(target, provider);
    const next: RestoreState = { ...outcomeValue, version: this.currentVersion(target, provider) + 1 };
    this.states.set(key, next);
    const waiters = this.waiters.get(key);
    if (!waiters) return;
    for (const waiter of [...waiters]) {
      if (waiter.afterVersion >= next.version) continue;
      this.timers.cancel(waiter.timer);
      waiters.delete(waiter);
      if (next.outcome === "ready") waiter.resolve();
      else waiter.reject(new Error(next.message));
    }
    if (waiters.size === 0) this.waiters.delete(key);
  }
}

function restoreKey(target: string, provider: AssistantProvider): string {
  return target + "\u0000" + provider;
}
