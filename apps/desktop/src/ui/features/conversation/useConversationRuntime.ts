import { useState } from "react";
import type { AssistantProvider } from "../../../shared/bridge";
import { runningThreadKey, threadViewKey } from "./session-state";

type ActiveThreadContext = { target: string; threadId: string; provider: AssistantProvider };

/** Own target-scoped drafts and turn lifecycle data shared by conversation features. */
export class ConversationRuntime {
  private readonly drafts = new Map<string, string>();
  private readonly runningThreads = new Map<string, number>();
  private readonly runningTurnIds = new Map<string, string>();
  private readonly observedTurnStarts = new Set<string>();
  private readonly interruptedTurns = new Set<string>();
  private activeThread: ActiveThreadContext;

  constructor(initialProvider: AssistantProvider) {
    this.activeThread = { target: "", threadId: "", provider: initialProvider };
  }

  setActiveThread(target: string, provider: AssistantProvider, threadId: string): void {
    this.activeThread = { target, provider, threadId };
  }

  clearActiveThread(provider: AssistantProvider): void {
    this.setActiveThread("", provider, "");
  }

  activeProvider(): AssistantProvider {
    return this.activeThread.provider;
  }

  isThreadSelected(target: string, provider: AssistantProvider, threadId: string): boolean {
    return this.activeThread.target === target && this.activeThread.provider === provider && this.activeThread.threadId === threadId;
  }

  draft(target: string, provider: AssistantProvider, threadId: string): string | undefined {
    return this.drafts.get(threadViewKey(target, provider, threadId));
  }

  saveDraft(target: string, provider: AssistantProvider, threadId: string, value: string): void {
    this.drafts.set(threadViewKey(target, provider, threadId), value);
  }

  clearDraft(target: string, provider: AssistantProvider, threadId: string): void {
    this.drafts.delete(threadViewKey(target, provider, threadId));
  }

  clearDrafts(): void {
    this.drafts.clear();
  }

  startThread(target: string, provider: AssistantProvider, threadId: string, startedAt: number): void {
    this.runningThreads.set(runningThreadKey(target, provider, threadId), startedAt);
  }

  isRunning(target: string, provider: AssistantProvider, threadId: string): boolean {
    return this.runningThreads.has(runningThreadKey(target, provider, threadId));
  }

  runningSince(target: string, provider: AssistantProvider, threadId: string): number | null {
    return this.runningThreads.get(runningThreadKey(target, provider, threadId)) ?? null;
  }

  setTurnId(target: string, provider: AssistantProvider, threadId: string, turnId: string): void {
    this.runningTurnIds.set(runningThreadKey(target, provider, threadId), turnId);
  }

  turnId(target: string, provider: AssistantProvider, threadId: string): string | undefined {
    return this.runningTurnIds.get(runningThreadKey(target, provider, threadId));
  }

  clearTurnId(target: string, provider: AssistantProvider, threadId: string): void {
    this.runningTurnIds.delete(runningThreadKey(target, provider, threadId));
  }

  observeTurnStart(target: string, provider: AssistantProvider, threadId: string): void {
    this.observedTurnStarts.add(runningThreadKey(target, provider, threadId));
  }

  hasObservedTurnStart(target: string, provider: AssistantProvider, threadId: string): boolean {
    return this.observedTurnStarts.has(runningThreadKey(target, provider, threadId));
  }

  clearObservedTurnStart(target: string, provider: AssistantProvider, threadId: string): void {
    this.observedTurnStarts.delete(runningThreadKey(target, provider, threadId));
  }

  markInterrupted(target: string, provider: AssistantProvider, threadId: string): void {
    this.interruptedTurns.add(runningThreadKey(target, provider, threadId));
  }

  clearInterrupted(target: string, provider: AssistantProvider, threadId: string): void {
    this.interruptedTurns.delete(runningThreadKey(target, provider, threadId));
  }

  completeTurn(target: string, provider: AssistantProvider, threadId: string): boolean {
    const key = runningThreadKey(target, provider, threadId);
    const wasInterrupted = this.interruptedTurns.delete(key);
    this.runningThreads.delete(key);
    this.runningTurnIds.delete(key);
    this.observedTurnStarts.delete(key);
    return wasInterrupted;
  }

  clearTurnTracking(target: string, provider: AssistantProvider, threadId: string): void {
    const key = runningThreadKey(target, provider, threadId);
    this.runningThreads.delete(key);
    this.runningTurnIds.delete(key);
    this.observedTurnStarts.delete(key);
    this.interruptedTurns.delete(key);
  }

  clearThread(target: string, provider: AssistantProvider, threadId: string): void {
    this.clearDraft(target, provider, threadId);
    this.clearTurnTracking(target, provider, threadId);
  }

  clear(provider: AssistantProvider): void {
    this.drafts.clear();
    this.runningThreads.clear();
    this.runningTurnIds.clear();
    this.observedTurnStarts.clear();
    this.interruptedTurns.clear();
    this.clearActiveThread(provider);
  }
}

export function useConversationRuntime(provider: AssistantProvider): ConversationRuntime {
  const [runtime] = useState(() => new ConversationRuntime(provider));
  return runtime;
}
