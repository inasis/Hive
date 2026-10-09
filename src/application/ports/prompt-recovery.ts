import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type PromptRecoveryRequestContext = {
  target: string;
  threadId: string;
  provider?: AssistantProvider;
};

export type PromptRecoveryResult = { accepted: true; turnId?: string };

export type PromptRecoveryOpenThreadRequest = {
  target: string;
  threadId: string;
  provider: AssistantProvider;
  includeTranscript: false;
};

export type PromptRecoveryEvent =
  | { type: "transportDisconnected"; target: string }
  | { type: "transportFailed"; target: string; message?: string }
  | { type: "turnStarted"; target: string; threadId: string; provider?: AssistantProvider };

export interface PromptRecoveryControllerPort<Request extends PromptRecoveryRequestContext> {
  submit(request: Request): Promise<PromptRecoveryResult>;
  markProviderRestored(target: string, provider: AssistantProvider): void;
  markProviderRestoreFailed(target: string, provider: AssistantProvider, message: string): void;
}

export interface PromptRecoveryEventSourcePort {
  subscribe(listener: (event: PromptRecoveryEvent) => void): () => void;
}

export interface ProviderRestoreSignalsPort {
  currentVersion(target: string, provider: AssistantProvider): number;
  waitForRestore(target: string, provider: AssistantProvider, afterVersion: number, timeoutMs: number): Promise<void>;
  markRestored(target: string, provider: AssistantProvider): void;
  markFailed(target: string, provider: AssistantProvider, message: string): void;
}

export interface PromptRecoveryContextPort {
  isDaemonClient(): boolean;
  getActiveProvider(): AssistantProvider;
}
