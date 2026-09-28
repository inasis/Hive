import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderOpenThreadResult } from "./provider-conversations.js";

export type ProviderSideConversationResult = Omit<ProviderOpenThreadResult, "entries">;

export type ProviderForkThreadInput = {
  turnId?: string;
  messageId?: string;
  name: string;
};

export type ProviderForkThreadResult = {
  target: string;
  threadId: string;
  title: string;
  cwd: string;
  preview: string;
  updatedAt: number;
  provider: AssistantProvider;
};

/** Provider-owned conversation branching and transcript rewind operations. */
export interface ProviderForkPort {
  forkSideThread(target: string, threadId: string): Promise<ProviderSideConversationResult>;
  forkThread(target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult>;
}

export type ProviderForkPorts = Record<AssistantProvider, ProviderForkPort>;
