import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import { deleteKiroSession } from "./cli.js";
import { forgetKiroSessionAlias, forgetKiroSessionPolicyPresets, renameKiroSession } from "../../persistence/kiro-session-metadata.js";
import { KiroSessionContext } from "./session-context.js";

/** Owns Kiro session rename and deletion, including cleanup of cached thread state. */
export class KiroSessionLifecycleAdapter implements ProviderSessionPort {
  constructor(private readonly context: KiroSessionContext) {}

  renameThread(target: string, threadId: string, name: string): Promise<void> {
    return renameKiroSession(target, threadId, name);
  }

  async deleteThread(target: string, threadId: string): Promise<void> {
    const session = this.context.get(target);
    await this.context.runAfterClosingConnection(target, () => deleteKiroSession(target, threadId));
    await forgetKiroSessionAlias(target, threadId);
    await forgetKiroSessionPolicyPresets(target, threadId);
    session?.updateUnsubscribers.get(threadId)?.();
    session?.updateUnsubscribers.delete(threadId);
    session?.openedThreadIds.delete(threadId);
    session?.settingsByThread.delete(threadId);
    session?.cwdByThread.delete(threadId);
    session?.policyPresetsByThread.delete(threadId);
    session?.activeTurnIds.delete(threadId);
    session?.commandsByThread.delete(threadId);
    session?.skillsByThread.delete(threadId);
    session?.modesByThread.delete(threadId);
    session?.currentModeByThread.delete(threadId);
    session?.transcriptsByThread.delete(threadId);
    this.context.forgetDisconnectedThread(target, threadId);
  }
}
