import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import { type CodexSessionContext } from "./session-context.js";
import { errorMessage } from "./protocol-utils.js";

/** Owns Codex thread rename and deletion lifecycle operations. */
export class CodexSessionLifecycleAdapter implements ProviderSessionPort {
  constructor(private readonly context: CodexSessionContext) {}

  async renameThread(target: string, threadId: string, name: string): Promise<void> {
    const session = await this.context.getOrConnect(target);
    await session.api.setThreadName(threadId, name);
  }

  async deleteThread(target: string, threadId: string): Promise<void> {
    const session = await this.context.getOrConnect(target);
    try {
      await session.api.deleteThread(threadId);
    } catch (error) {
      // The app-server may complete deletion but lose or delay the response. Confirm against its
      // authoritative list before reporting failure to the UI.
      try {
        const remaining = await session.api.listThreads({ limit: 500, timeoutMs: 10_000 });
        if (remaining.some((thread) => thread.id === threadId)) throw error;
      } catch (verificationError) {
        if (verificationError === error) throw error;
        throw new Error(`${errorMessage(error)} (삭제 여부를 확인하지 못했습니다: ${errorMessage(verificationError)})`, { cause: error });
      }
    }
    session.openedThreadIds.delete(threadId);
    session.freshThreadIds.delete(threadId);
    session.skillsByThread.delete(threadId);
    session.settingsByThread.delete(threadId);
    if (session.activeThreadId === threadId) delete session.activeThreadId;
  }
}
