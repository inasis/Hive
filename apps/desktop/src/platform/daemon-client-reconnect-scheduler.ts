import { DaemonReconnectPolicy } from "../../../../src/infrastructure/transport/daemon-reconnect-policy.js";

/** Own page lifecycle listeners and retry timer scheduling for a daemon client. */
export class DaemonClientReconnectScheduler {
  private readonly policy = new DaemonReconnectPolicy();
  private timer: number | null = null;
  private stopped = true;

  constructor(private readonly onNetworkAvailable: () => void) {}

  start(): void {
    this.stop();
    this.stopped = false;
    this.policy.reset();
    window.addEventListener("online", this.handleNetworkAvailable);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  stop(): void {
    this.stopped = true;
    this.policy.reset();
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    window.removeEventListener("online", this.handleNetworkAvailable);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  isStopped(): boolean {
    return this.stopped;
  }

  schedule(canReconnect: () => boolean, reconnect: () => void, delayMs?: number): void {
    if (this.stopped || !canReconnect()) return;
    if (this.timer !== null) {
      if (delayMs !== 0) return;
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const delay = delayMs ?? this.policy.nextDelayMs();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.stopped || !canReconnect()) return;
      reconnect();
    }, delay);
  }

  resetPolicy(): void {
    this.policy.reset();
  }

  isCredentialFailure(message: string): boolean {
    return this.policy.isCredentialFailure(message);
  }

  private handleNetworkAvailable = (): void => this.onNetworkAvailable();

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") this.onNetworkAvailable();
  };
}
