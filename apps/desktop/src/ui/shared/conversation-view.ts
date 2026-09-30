import type { AssistantProvider, PromptImageAttachment, RemoteMode, RemoteSkill, TranscriptEntry } from "../../shared/bridge";

export type ThreadView = {
  target: string;
  threadId: string;
  provider: AssistantProvider;
  title: string;
  cwd: string;
  model: string;
  effort: string | null;
  permissionProfile: string | null;
  modes: RemoteMode[];
  currentModeId: string | null;
  entries: TranscriptEntry[];
  skills: RemoteSkill[];
  skillWarnings: string[];
};

export type SideChatTab = {
  target: string;
  threadId: string;
  provider: AssistantProvider;
  parentThreadId: string;
  rootThreadId: string;
  label: string;
  persistent?: boolean;
};

export type LocalImageAttachment = PromptImageAttachment & { id: string };

export function threadViewKey(target: string, provider: AssistantProvider, threadId: string): string {
  return `${target}\u0000${provider}\u0000${threadId}`;
}

export function runningThreadKey(target: string, provider: AssistantProvider, threadId: string): string {
  return threadViewKey(target, provider, threadId);
}
