import type { ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import type { KiroRemoteSession, KiroSessionContext } from "./session-context.js";

type OpenThread = (target: string, threadId: string) => Promise<ProviderOpenThreadResult>;
type LoadThread = (target: string, threadId: string) => Promise<ProviderOpenThreadResult>;
export type KiroRequireOpenThread = (target: string, threadId: string) => Promise<KiroRemoteSession>;

/** Serializes Kiro session hydration and reopens threads after ACP reconnects. */
export class KiroThreadAccess {
  private readonly openingThreads = new Map<string, Promise<ProviderOpenThreadResult>>();

  constructor(private readonly context: KiroSessionContext) {}

  async openThread(target: string, threadId: string, loadThread: LoadThread): Promise<ProviderOpenThreadResult> {
    const key = threadRecoveryKey(target, threadId);
    const pending = this.openingThreads.get(key);
    if (pending) return pending;
    const task = loadThread(target, threadId).then((result) => {
      this.context.forgetDisconnectedThread(target, threadId);
      return result;
    });
    this.openingThreads.set(key, task);
    try {
      return await task;
    } finally {
      if (this.openingThreads.get(key) === task) this.openingThreads.delete(key);
    }
  }

  async requireOpenThread(target: string, threadId: string, openThread: OpenThread): Promise<KiroRemoteSession> {
    let session = await this.context.getOrConnect(target);
    const opening = this.openingThreads.get(threadRecoveryKey(target, threadId));
    if (opening) {
      await opening;
      return this.context.require(target);
    }
    if (session.openedThreadIds.has(threadId)) return session;
    if (this.context.isThreadDisconnected(target, threadId)) {
      await openThread(target, threadId);
      session = this.context.require(target);
    }
    return session;
  }
}

function threadRecoveryKey(target: string, threadId: string): string {
  return `${target}\u0000${threadId}`;
}
