import type { CachedTranscriptPageDto, TranscriptCacheViewDto, TranscriptResponseGroupDto } from "../../../../src/application/dto/transcript-cache.js";
import type { CacheMetadata } from "./hive-transcript-cache-records.js";

export const MIN_CACHED_RESPONSE_GROUPS = 10;

type MemoryThread = { metadata: CacheMetadata; groups: TranscriptResponseGroupDto[] };
type OlderTranscriptPage = { groups: TranscriptResponseGroupDto[]; firstIndex: number; hasOlder: boolean };

/** In-memory fallback for transcript page persistence when IndexedDB is unavailable. */
export class HiveMemoryTranscriptPages {
  private readonly threads = new Map<string, MemoryThread>();

  readLatest(threadKey: string, limit: number): CachedTranscriptPageDto | undefined {
    const current = this.threads.get(threadKey);
    if (!current || current.groups.length < MIN_CACHED_RESPONSE_GROUPS) return undefined;
    const firstIndex = Math.max(0, current.groups.length - limit);
    return {
      groups: current.groups.slice(firstIndex),
      firstIndex,
      totalGroups: current.groups.length,
      hasOlder: firstIndex > 0,
      sourceUpdatedAt: current.metadata.sourceUpdatedAt,
      view: current.metadata.view,
    };
  }

  readOlder(threadKey: string, beforeGroupId: string, limit: number): OlderTranscriptPage {
    const groups = this.threads.get(threadKey)?.groups ?? [];
    const beforeIndex = groups.findIndex((group) => group.id === beforeGroupId);
    if (beforeIndex <= 0) return { groups: [], firstIndex: Math.max(0, beforeIndex), hasOlder: false };
    const firstIndex = Math.max(0, beforeIndex - limit);
    return { groups: groups.slice(firstIndex, beforeIndex), firstIndex, hasOlder: firstIndex > 0 };
  }

  replaceAll(threadKey: string, metadata: CacheMetadata, groups: TranscriptResponseGroupDto[]): void {
    this.threads.set(threadKey, { metadata, groups });
  }

  mergeRecent(
    threadKey: string,
    view: TranscriptCacheViewDto,
    groups: TranscriptResponseGroupDto[],
    sourceUpdatedAt: string | number | null,
  ): void {
    const current = this.threads.get(threadKey);
    if (!current) {
      this.threads.set(threadKey, {
        metadata: {
          threadKey,
          groupCount: groups.length,
          updatedAt: Date.now(),
          sourceUpdatedAt,
          view: metadataFromView(view),
        },
        groups,
      });
      return;
    }

    const nextGroups = [...current.groups];
    for (const group of groups) {
      const index = nextGroups.findIndex((candidate) => candidate.id === group.id);
      if (index >= 0) nextGroups[index] = group;
      else nextGroups.push(group);
    }
    current.groups = nextGroups;
    current.metadata = {
      ...current.metadata,
      groupCount: nextGroups.length,
      updatedAt: Date.now(),
      sourceUpdatedAt: sourceUpdatedAt ?? current.metadata.sourceUpdatedAt,
      view: metadataFromView(view),
    };
  }

  delete(threadKey: string): void {
    this.threads.delete(threadKey);
  }
}

function metadataFromView(view: TranscriptCacheViewDto): CacheMetadata["view"] {
  const { entries: _entries, ...metadata } = view;
  return metadata;
}
