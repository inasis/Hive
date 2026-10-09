import type { CachedTranscriptPageDto, TranscriptResponseGroupDto } from "../../../../src/application/dto/transcript-cache.js";
import type { ThreadViewMetadata, CacheGroup, CacheMetadata } from "./hive-transcript-cache-records.js";
import { isCacheGroup, isCacheMetadata } from "./hive-transcript-cache-records.js";
import { groupRange } from "./hive-transcript-database.js";

/** IndexedDB implementation for persisted transcript response-group pages. */
export class HiveIndexedDbTranscriptPages {
  async readLatest(
    database: IDBDatabase,
    threadKey: string,
    limit: number,
    minimumGroupCount: number,
  ): Promise<CachedTranscriptPageDto | undefined> {
    return new Promise((resolve) => {
      const transaction = database.transaction(["metadata", "groups"], "readonly");
      const metadataRequest = transaction.objectStore("metadata").get(threadKey) as IDBRequest<CacheMetadata | undefined>;
      metadataRequest.onsuccess = () => {
        const metadataValue: unknown = metadataRequest.result;
        if (!isCacheMetadata(metadataValue) || metadataValue.threadKey !== threadKey) {
          resolve(undefined);
          return;
        }
        const metadata = metadataValue;
        if (metadata.groupCount < minimumGroupCount) {
          resolve(undefined);
          return;
        }
        const firstIndex = Math.max(0, metadata.groupCount - limit);
        const recordsRequest = transaction.objectStore("groups").getAll(groupRange(threadKey, firstIndex, metadata.groupCount - 1)) as IDBRequest<CacheGroup[]>;
        recordsRequest.onsuccess = () => {
          const records: unknown = recordsRequest.result;
          resolve(Array.isArray(records) && records.every(isCacheGroup) ? this.toPage(metadata, records) : undefined);
        };
      };
      transaction.onerror = () => resolve(undefined);
    });
  }

  async readOlder(
    database: IDBDatabase,
    threadKey: string,
    beforeGroupId: string,
    limit: number,
  ): Promise<{ groups: TranscriptResponseGroupDto[]; firstIndex: number; hasOlder: boolean }> {
    return new Promise((resolve) => {
      const transaction = database.transaction(["groups"], "readonly");
      const store = transaction.objectStore("groups");
      const beforeRequest = store.index("threadAndId").get([threadKey, beforeGroupId]) as IDBRequest<CacheGroup | undefined>;
      beforeRequest.onsuccess = () => {
        const before = beforeRequest.result;
        if (!isCacheGroup(before) || before.threadKey !== threadKey || before.index === 0) {
          resolve({ groups: [], firstIndex: before?.index ?? 0, hasOlder: false });
          return;
        }
        const firstIndex = Math.max(0, before.index - limit);
        const recordsRequest = store.getAll(groupRange(threadKey, firstIndex, before.index - 1)) as IDBRequest<CacheGroup[]>;
        recordsRequest.onsuccess = () => {
          const records: unknown = recordsRequest.result;
          if (!Array.isArray(records) || !records.every(isCacheGroup)) {
            resolve({ groups: [], firstIndex, hasOlder: false });
            return;
          }
          resolve({
            groups: records.map(({ id, entries }) => ({ id, entries })),
            firstIndex,
            hasOlder: firstIndex > 0,
          });
        };
      };
      transaction.onerror = () => resolve({ groups: [], firstIndex: 0, hasOlder: false });
    });
  }

  async replaceAll(
    database: IDBDatabase,
    threadKey: string,
    metadata: CacheMetadata,
    groups: readonly TranscriptResponseGroupDto[],
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const transaction = database.transaction(["metadata", "groups"], "readwrite");
      const store = transaction.objectStore("groups");
      const cursorRequest = store.index("threadKey").openKeyCursor(IDBKeyRange.only(threadKey));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
          return;
        }
        groups.forEach((group, index) => store.put({ ...group, threadKey, index } satisfies CacheGroup));
        transaction.objectStore("metadata").put(metadata);
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    });
  }

  async mergeRecent(
    database: IDBDatabase,
    threadKey: string,
    groups: readonly TranscriptResponseGroupDto[],
    sourceUpdatedAt: string | number | null,
    view: ThreadViewMetadata,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(["metadata", "groups"], "readwrite");
      const store = transaction.objectStore("groups");
      const metadataStore = transaction.objectStore("metadata");
      const metadataRequest = metadataStore.get(threadKey) as IDBRequest<CacheMetadata | undefined>;
      metadataRequest.onsuccess = () => {
        const current = metadataRequest.result ?? {
          threadKey,
          groupCount: 0,
          updatedAt: Date.now(),
          sourceUpdatedAt,
          view,
        } satisfies CacheMetadata;
        const upsertGroup = (groupIndex: number) => {
          if (groupIndex >= groups.length) {
            metadataStore.put({
              ...current,
              groupCount: current.groupCount,
              updatedAt: Date.now(),
              sourceUpdatedAt: sourceUpdatedAt ?? current.sourceUpdatedAt,
              view,
            } satisfies CacheMetadata);
            return;
          }
          const group = groups[groupIndex]!;
          const findRequest = store.index("threadAndId").get([threadKey, group.id]) as IDBRequest<CacheGroup | undefined>;
          findRequest.onsuccess = () => {
            const existing = findRequest.result;
            const index = existing?.index ?? current.groupCount++;
            store.put({ ...group, threadKey, index } satisfies CacheGroup);
            upsertGroup(groupIndex + 1);
          };
        };
        upsertGroup(0);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  async deleteAll(database: IDBDatabase, threadKey: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(["metadata", "groups"], "readwrite");
      const store = transaction.objectStore("groups");
      const cursorRequest = store.index("threadKey").openKeyCursor(IDBKeyRange.only(threadKey));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          transaction.objectStore("metadata").delete(threadKey);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  private toPage(metadata: CacheMetadata, records: CacheGroup[]): CachedTranscriptPageDto {
    return {
      groups: records.map(({ id, entries }) => ({ id, entries })),
      firstIndex: records[0]?.index ?? metadata.groupCount,
      totalGroups: metadata.groupCount,
      hasOlder: (records[0]?.index ?? metadata.groupCount) > 0,
      sourceUpdatedAt: metadata.sourceUpdatedAt,
      view: metadata.view,
    };
  }
}
