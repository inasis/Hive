import { resolve } from "node:path";
import type { A2AWorkspaceLockPort } from "../../application/ports/a2a-runtime.js";

type Waiter = {
  signal: AbortSignal;
  resolve(release: () => void): void;
  reject(error: Error): void;
  onAbort(): void;
};

/** Fair process-local exclusive locks keyed by normalized workspace path. */
export class InMemoryA2AWorkspaceLockManager implements A2AWorkspaceLockPort {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, Waiter[]>();

  acquire(workspace: string, signal: AbortSignal): Promise<() => void> {
    if (!workspace.trim()) return Promise.resolve(() => undefined);
    if (signal.aborted) return Promise.reject(new Error("Workspace lock acquisition was cancelled"));
    const key = workspaceKey(workspace);
    if (!this.held.has(key)) {
      this.held.add(key);
      return Promise.resolve(this.createRelease(key));
    }
    return new Promise<() => void>((resolvePromise, reject) => {
      const queue = this.queues.get(key) ?? [];
      const waiter: Waiter = {
        signal,
        resolve: resolvePromise,
        reject,
        onAbort: () => {
          const current = this.queues.get(key);
          if (!current) return;
          const index = current.indexOf(waiter);
          if (index >= 0) current.splice(index, 1);
          if (current.length === 0) this.queues.delete(key);
          reject(new Error("Workspace lock acquisition was cancelled"));
        },
      };
      queue.push(waiter);
      this.queues.set(key, queue);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal.aborted) waiter.onAbort();
    });
  }

  private createRelease(key: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const queue = this.queues.get(key);
      while (queue?.length) {
        const next = queue.shift()!;
        next.signal.removeEventListener("abort", next.onAbort);
        if (next.signal.aborted) {
          next.reject(new Error("Workspace lock acquisition was cancelled"));
          continue;
        }
        if (queue.length === 0) this.queues.delete(key);
        next.resolve(this.createRelease(key));
        return;
      }
      this.queues.delete(key);
      this.held.delete(key);
    };
  }
}

function workspaceKey(workspace: string): string {
  const normalized = resolve(workspace);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
