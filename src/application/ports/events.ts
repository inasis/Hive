import type { AssistantCommandDto, ReasoningEffortDto } from "../dto/assistant.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { A2ACommunicationSummaryItemDto } from "../dto/a2a-communication.js";

export type AssistantToolActivity =
  | { kind: "commandExecution"; id?: string; command?: string; output?: string; status?: string }
  | { kind: "fileChange"; id?: string; paths: string[]; status?: string }
  | { kind: "webSearch"; id?: string; queries: string[]; output?: string; status?: string };

export type AssistantApprovalDetails = {
  kind: "command" | "file" | "permission" | "other";
  command?: string;
  cwd?: string;
  reason?: string;
  itemId?: string;
  options?: Array<{ id: string; label: string; kind?: string }>;
};

/** Provider and workspace events exchanged between adapters and application composition. */
export type AssistantEventPayload =
  | { type: "threadCreated"; title: string; cwd: string; preview: string; updatedAt: string | number | null; hiveSessionId?: string }
  | { type: "threadRenamed"; title: string }
  | { type: "threadDeleted" }
  | { type: "transcriptCleared" }
  | { type: "turnStarted"; turnId?: string }
  | { type: "turnCompleted"; turnId?: string; status?: string; error?: string }
  | { type: "assistantDelta"; turnId: string; messageId: string; text: string }
  | { type: "assistantMessageCompleted"; turnId: string; messageId: string; text: string }
  | { type: "a2aCommunicationSummary"; summaryId: string; communications: A2ACommunicationSummaryItemDto[]; responseTurnId?: string }
  | { type: "threadSettingsUpdated"; settings: {
      model?: string;
      effort?: string;
      permissionProfile?: string;
      currentModeId?: string;
      supportedReasoningEfforts?: ReasoningEffortDto[];
    } }
  | { type: "commandsUpdated"; commands: AssistantCommandDto[] }
  | { type: "toolStarted"; turnId?: string; activity: AssistantToolActivity }
  | { type: "toolCompleted"; turnId?: string; activity: AssistantToolActivity }
  | { type: "warning"; message: string }
  | { type: "approvalRequested"; requestId: number | string; approval: AssistantApprovalDetails };

export type AssistantEvent = AssistantEventPayload & {
  target: string;
  threadId: string;
  provider?: AssistantProvider;
};

/** Event shape without delivery context, useful to provider adapters. */
export type AssistantEventInput = AssistantEventPayload;

export type AssistantEventPublisher = (event: AssistantEvent) => void;
