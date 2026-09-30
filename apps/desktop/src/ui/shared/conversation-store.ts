import type { AssistantProvider } from "../../shared/bridge";
import type { LocalImageAttachment, ThreadView } from "./conversation-view";

export type ThreadViewStorePort = {
  get(target: string, provider: AssistantProvider, threadId: string): ThreadView | undefined;
  set(view: ThreadView): void;
  getImageAttachments(target: string, provider: AssistantProvider, threadId: string): LocalImageAttachment[] | undefined;
  setImageAttachments(target: string, provider: AssistantProvider, threadId: string, attachments: LocalImageAttachment[]): void;
  clearImageAttachments(target: string, provider: AssistantProvider, threadId: string): void;
  update(target: string, provider: AssistantProvider, threadId: string, update: (view: ThreadView) => ThreadView): void;
  delete(target: string, provider: AssistantProvider, threadId: string): void;
  clear(): void;
};

export type ConversationRuntimePort = {
  setActiveThread(target: string, provider: AssistantProvider, threadId: string): void;
  clearActiveThread(provider: AssistantProvider): void;
  activeProvider(): AssistantProvider;
  isThreadSelected(target: string, provider: AssistantProvider, threadId: string): boolean;
  draft(target: string, provider: AssistantProvider, threadId: string): string | undefined;
  saveDraft(target: string, provider: AssistantProvider, threadId: string, value: string): void;
  clearDraft(target: string, provider: AssistantProvider, threadId: string): void;
  clearDrafts(): void;
  startThread(target: string, provider: AssistantProvider, threadId: string, startedAt: number): void;
  isRunning(target: string, provider: AssistantProvider, threadId: string): boolean;
  runningSince(target: string, provider: AssistantProvider, threadId: string): number | null;
  setTurnId(target: string, provider: AssistantProvider, threadId: string, turnId: string): void;
  turnId(target: string, provider: AssistantProvider, threadId: string): string | undefined;
  clearTurnId(target: string, provider: AssistantProvider, threadId: string): void;
  observeTurnStart(target: string, provider: AssistantProvider, threadId: string): void;
  hasObservedTurnStart(target: string, provider: AssistantProvider, threadId: string): boolean;
  clearObservedTurnStart(target: string, provider: AssistantProvider, threadId: string): void;
  markInterrupted(target: string, provider: AssistantProvider, threadId: string): void;
  clearInterrupted(target: string, provider: AssistantProvider, threadId: string): void;
  completeTurn(target: string, provider: AssistantProvider, threadId: string): boolean;
  clearTurnTracking(target: string, provider: AssistantProvider, threadId: string): void;
  clearThread(target: string, provider: AssistantProvider, threadId: string): void;
  clear(provider: AssistantProvider): void;
};
