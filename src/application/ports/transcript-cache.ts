import type { A2ACommunicationSummaryItemDto } from "../dto/a2a-communication.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type {
  CachedCommunicationSummaryDto,
  CachedTranscriptPageDto,
  TranscriptCacheViewDto,
  TranscriptResponseGroupDto,
} from "../dto/transcript-cache.js";

export type CommunicationSummaryCachePort = {
  saveCommunicationSummary(
    target: string,
    provider: AssistantProvider,
    threadId: string,
    summaryId: string,
    communications: A2ACommunicationSummaryItemDto[],
    responseTurnId?: string,
  ): Promise<void>;
  readCommunicationSummaries(target: string, provider: AssistantProvider, threadId: string): Promise<CachedCommunicationSummaryDto[]>;
  clearCommunicationSummaries(target: string, provider: AssistantProvider, threadId: string): Promise<void>;
};

/** Local transcript response-page persistence contract consumed by the desktop conversation UI. */
export type TranscriptPageCachePort = {
  readLatest(target: string, provider: AssistantProvider, threadId: string, limit: number): Promise<CachedTranscriptPageDto | undefined>;
  readOlder(target: string, provider: AssistantProvider, threadId: string, beforeGroupId: string, limit: number): Promise<{
    groups: TranscriptResponseGroupDto[];
    firstIndex: number;
    hasOlder: boolean;
  }>;
  replaceAll(view: TranscriptCacheViewDto, sourceUpdatedAt: string | number | null): Promise<void>;
  saveRecent(view: TranscriptCacheViewDto, sourceUpdatedAt?: string | number | null): void;
  delete(target: string, provider: AssistantProvider, threadId: string): Promise<void>;
  hasOlder(target: string, provider: AssistantProvider, threadId: string, firstGroupId: string): Promise<boolean>;
};

/** Composite local cache contract for a provider thread's transcript and communication summaries. */
export type TranscriptCachePort = CommunicationSummaryCachePort & TranscriptPageCachePort;
