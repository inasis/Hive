import type { AssistantProvider, PromptFileAttachment, PromptImageAttachment } from "./bridge";
import type { TranscriptCacheViewDto } from "../../application/dto/transcript-cache.js";

export type ThreadView = TranscriptCacheViewDto;

export type SideChatTab = {
  target: string;
  threadId: string;
  provider: AssistantProvider;
  parentThreadId: string;
  rootThreadId: string;
  label: string;
  persistent?: boolean;
  kind?: "session" | "fork" | "temporary";
};

export type LocalImageAttachment = PromptImageAttachment & { id: string };
export type LocalFileAttachment = PromptFileAttachment & { id: string };

export function threadViewKey(target: string, provider: AssistantProvider, threadId: string): string {
  return `${target}\u0000${provider}\u0000${threadId}`;
}

export function runningThreadKey(target: string, provider: AssistantProvider, threadId: string): string {
  return threadViewKey(target, provider, threadId);
}
