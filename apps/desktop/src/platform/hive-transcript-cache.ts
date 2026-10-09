import type { AssistantProvider } from "../../../../src/domain/provider-catalog.js";
import { groupTranscriptResponseDtos } from "../../../../src/application/mappers/transcript-cache-mapper.js";
import type { CachedTranscriptPageDto, TranscriptCacheViewDto, TranscriptResponseGroupDto } from "../../../../src/application/dto/transcript-cache.js";
import type { TranscriptCachePort } from "../../../../src/application/ports/transcript-cache.js";
import { hiveCommunicationSummaryCache } from "./hive-communication-summary-cache.js";
import { HiveIndexedDbTranscriptPages } from "./hive-indexeddb-transcript-pages.js";
import { HiveMemoryTranscriptPages, MIN_CACHED_RESPONSE_GROUPS } from "./hive-memory-transcript-pages.js";
import { cacheKey, openTranscriptDatabase } from "./hive-transcript-database.js";
import type { CacheMetadata, ThreadViewMetadata } from "./hive-transcript-cache-records.js";

const memoryTranscriptPages = new HiveMemoryTranscriptPages();
const indexedDbTranscriptPages = new HiveIndexedDbTranscriptPages();
const pendingWrites = new Map<string, { view: TranscriptCacheViewDto; sourceUpdatedAt: string | number | null }>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Persist provider transcripts locally and expose response-group pages without loading every page. */
const cacheImplementation = {
  ...hiveCommunicationSummaryCache,

  async readLatest(target: string, provider: AssistantProvider, threadId: string, limit: number): Promise<CachedTranscriptPageDto | undefined> {
    const threadKey = cacheKey(target, provider, threadId);
    const database = await openTranscriptDatabase();
    if (!database) return memoryTranscriptPages.readLatest(threadKey, limit);
    return indexedDbTranscriptPages.readLatest(database, threadKey, limit, MIN_CACHED_RESPONSE_GROUPS);
  },

  async readOlder(
    target: string,
    provider: AssistantProvider,
    threadId: string,
    beforeGroupId: string,
    limit: number,
  ): Promise<{ groups: TranscriptResponseGroupDto[]; firstIndex: number; hasOlder: boolean }> {
    const threadKey = cacheKey(target, provider, threadId);
    const database = await openTranscriptDatabase();
    if (!database) return memoryTranscriptPages.readOlder(threadKey, beforeGroupId, limit);
    return indexedDbTranscriptPages.readOlder(database, threadKey, beforeGroupId, limit);
  },

  async replaceAll(view: TranscriptCacheViewDto, sourceUpdatedAt: string | number | null): Promise<void> {
    const threadKey = cacheKey(view.target, view.provider, view.threadId);
    const groups = groupTranscriptResponseDtos(view.entries);
    const metadata: CacheMetadata = {
      threadKey,
      groupCount: groups.length,
      updatedAt: Date.now(),
      sourceUpdatedAt,
      view: metadataFromView(view),
    };
    const database = await openTranscriptDatabase();
    if (!database) {
      memoryTranscriptPages.replaceAll(threadKey, metadata, groups);
      return;
    }

    try {
      const saved = await indexedDbTranscriptPages.replaceAll(database, threadKey, metadata, groups);
      if (saved) memoryTranscriptPages.delete(threadKey);
    } catch { /* A cache write must not block opening a provider conversation. */ }
  },

  /** Debounce streaming updates; each flush only touches response groups in the active transcript window. */
  saveRecent(view: TranscriptCacheViewDto, sourceUpdatedAt: string | number | null = null): void {
    const threadKey = cacheKey(view.target, view.provider, view.threadId);
    pendingWrites.set(threadKey, { view, sourceUpdatedAt });
    const previous = writeTimers.get(threadKey);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      writeTimers.delete(threadKey);
      const pending = pendingWrites.get(threadKey);
      pendingWrites.delete(threadKey);
      if (pending) void this.mergeRecent(threadKey, pending.view, pending.sourceUpdatedAt).catch(() => undefined);
    }, 350);
    writeTimers.set(threadKey, timer);
  },

  async delete(target: string, provider: AssistantProvider, threadId: string): Promise<void> {
    const threadKey = cacheKey(target, provider, threadId);
    memoryTranscriptPages.delete(threadKey);
    pendingWrites.delete(threadKey);
    const timer = writeTimers.get(threadKey);
    if (timer) clearTimeout(timer);
    writeTimers.delete(threadKey);
    const database = await openTranscriptDatabase();
    if (!database) {
      await hiveCommunicationSummaryCache.clearCommunicationSummaries(target, provider, threadId);
      return;
    }
    await indexedDbTranscriptPages.deleteAll(database, threadKey);
    await hiveCommunicationSummaryCache.clearCommunicationSummaries(target, provider, threadId);
  },

  async hasOlder(target: string, provider: AssistantProvider, threadId: string, firstGroupId: string): Promise<boolean> {
    const page = await this.readOlder(target, provider, threadId, firstGroupId, 1);
    return page.groups.length > 0;
  },

  async mergeRecent(threadKey: string, view: TranscriptCacheViewDto, sourceUpdatedAt: string | number | null): Promise<void> {
    const groups = groupTranscriptResponseDtos(view.entries);
    if (!groups.length) {
      await this.replaceAll(view, sourceUpdatedAt);
      return;
    }
    const database = await openTranscriptDatabase();
    if (!database) {
      memoryTranscriptPages.mergeRecent(threadKey, view, groups, sourceUpdatedAt);
      return;
    }

    await indexedDbTranscriptPages.mergeRecent(database, threadKey, groups, sourceUpdatedAt, metadataFromView(view));
  },
};

export const hiveTranscriptCache: TranscriptCachePort = cacheImplementation;

function metadataFromView(view: TranscriptCacheViewDto): ThreadViewMetadata {
  const { entries: _entries, ...metadata } = view;
  return metadata;
}
