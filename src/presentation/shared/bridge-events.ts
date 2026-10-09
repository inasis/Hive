import type { AssistantCommandDto, ReasoningEffortDto } from "../../application/dto/assistant.js";
import type { A2ACommunicationSummaryItemDto } from "../../application/dto/a2a-communication.js";
import type { TranscriptEntryDto } from "../../application/dto/transcript-cache.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

type EventContext = { target: string; threadId: string; provider?: AssistantProvider };

export type ApprovalUiDetails = {
  kind: "command" | "file" | "permission" | "other";
  reason?: string;
  command?: string;
  cwd?: string;
  itemId?: string;
};

export type ApprovalUiRequest = ApprovalUiDetails & {
  requestId: number | string;
  target?: string;
  hostname?: string;
  threadId?: string;
  provider: AssistantProvider;
};

export type UiCommand = Omit<AssistantCommandDto, "provider"> & { provider?: string };

/** Desktop presentation event contract after the platform adapter maps daemon events. */
export type UiBridgeEvent =
  | (EventContext & { type: "threadCreated"; title: string; cwd: string; preview: string; updatedAt: string | number | null; hiveSessionId?: string })
  | (EventContext & { type: "approvalRequested"; requestId: number | string; approval: ApprovalUiDetails })
  | (EventContext & { type: "threadRenamed"; title: string })
  | (EventContext & { type: "threadDeleted" })
  | (EventContext & { type: "transcriptCleared" })
  | (EventContext & { type: "turnStarted"; turnId?: string })
  | (EventContext & { type: "turnCompleted"; turnId?: string; error?: string })
  | (EventContext & { type: "assistantDelta"; turnId: string; messageId: string; text: string })
  | (EventContext & { type: "threadSettingsUpdated"; settings: {
      model?: string;
      effort: string | null;
      permissionProfile: string | null;
      modeId: string | null;
      supportedReasoningEfforts?: ReasoningEffortDto[];
    } })
  | (EventContext & { type: "commandsUpdated"; commands: UiCommand[] })
  | (EventContext & { type: "transcriptEntriesUpdated"; entries: TranscriptEntryDto[]; replaceIdPrefix?: string })
  | (EventContext & { type: "assistantMessageCompleted"; turnId: string; messageId: string; text: string })
  | (EventContext & { type: "a2aCommunicationSummary"; summaryId: string; communications: A2ACommunicationSummaryItemDto[]; responseTurnId?: string })
  | (EventContext & { type: "warning"; message: string })
  | (EventContext & { type: "terminalReady" })
  | (EventContext & { type: "terminalData"; data: string })
  | (EventContext & { type: "terminalError"; message: string })
  | (EventContext & { type: "terminalExit"; exitCode: number | null })
  | (EventContext & { type: "transportDisconnected"; message?: string })
  | (EventContext & { type: "transportFailed"; message?: string })
  | (EventContext & { type: "transportKeepAliveFailed"; message?: string })
  | (EventContext & { type: "transportReconnected" });

export type UiBridgeEventListener = (event: UiBridgeEvent) => void;
