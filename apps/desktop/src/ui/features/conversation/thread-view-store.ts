import type { AssistantProvider } from "../../../shared/bridge";
import { threadViewKey, type LocalImageAttachment, type ThreadView } from "./session-state";

/** Own cached conversation views and per-thread attachments behind one lifecycle API. */
export class ThreadViewStore {
  private readonly views = new Map<string, ThreadView>();
  private readonly imageAttachments = new Map<string, LocalImageAttachment[]>();

  get(target: string, provider: AssistantProvider, threadId: string): ThreadView | undefined {
    return this.views.get(threadViewKey(target, provider, threadId));
  }

  set(view: ThreadView): void {
    this.views.set(threadViewKey(view.target, view.provider, view.threadId), view);
  }

  getImageAttachments(target: string, provider: AssistantProvider, threadId: string): LocalImageAttachment[] | undefined {
    return this.imageAttachments.get(threadViewKey(target, provider, threadId));
  }

  setImageAttachments(target: string, provider: AssistantProvider, threadId: string, attachments: LocalImageAttachment[]): void {
    this.imageAttachments.set(threadViewKey(target, provider, threadId), attachments);
  }

  clearImageAttachments(target: string, provider: AssistantProvider, threadId: string): void {
    this.imageAttachments.delete(threadViewKey(target, provider, threadId));
  }

  update(
    target: string,
    provider: AssistantProvider,
    threadId: string,
    update: (view: ThreadView) => ThreadView,
  ): void {
    const key = threadViewKey(target, provider, threadId);
    const current = this.views.get(key);
    if (current) this.views.set(key, update(current));
  }

  delete(target: string, provider: AssistantProvider, threadId: string): void {
    const key = threadViewKey(target, provider, threadId);
    this.views.delete(key);
    this.imageAttachments.delete(key);
  }

  clear(): void {
    this.views.clear();
    this.imageAttachments.clear();
  }
}
