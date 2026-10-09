import type { A2ACommunicationSummaryItemDto } from "../../../../src/application/dto/a2a-communication.js";
import { a2aCommunicationGroupKey } from "../../../../src/application/mappers/a2a-communication-mapper.js";
import type { AssistantProvider } from "../../../../src/domain/provider-catalog.js";
import { isCacheGroup, type CacheCommunicationSummary } from "./hive-transcript-cache-records.js";

const DATABASE_NAME = "hive-transcript-cache";
const DATABASE_VERSION = 3;
let databasePromise: Promise<IDBDatabase | null> | undefined;

export function openTranscriptDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (event.oldVersion < 1) {
        const groups = database.createObjectStore("groups", { keyPath: ["threadKey", "index"] });
        groups.createIndex("threadKey", "threadKey");
        groups.createIndex("threadAndId", ["threadKey", "id"], { unique: true });
        database.createObjectStore("metadata", { keyPath: "threadKey" });
      }
      if (event.oldVersion < 2) {
        // Rebuild old normalized transcripts through provider mappers so A2A messages become communication entries.
        request.transaction?.objectStore("groups").clear();
        request.transaction?.objectStore("metadata").clear();
      }
      if (event.oldVersion < 3) {
        const communications = database.createObjectStore("communications", { keyPath: ["threadKey", "summaryId"] });
        communications.createIndex("threadKey", "threadKey");
        if (event.oldVersion >= 2) {
          const cursorRequest = request.transaction?.objectStore("groups").openCursor();
          if (cursorRequest) cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const groupValue: unknown = cursor.value;
            if (isCacheGroup(groupValue)) {
              const summaryEntries = groupValue.entries.filter((entry) => entry.role === "communication");
              for (const entry of summaryEntries) {
                const summaryId = a2aCommunicationGroupKey(entry.communications ?? []);
                if (!summaryId || !entry.communications?.length) continue;
                communications.put({
                  threadKey: groupValue.threadKey,
                  summaryId,
                  communications: entry.communications,
                  createdAt: entry.createdAt ?? earliestCommunicationCreatedAt(entry.communications),
                  updatedAt: Date.now(),
                  ...(entry.turnId ? { responseTurnId: entry.turnId } : {}),
                } satisfies CacheCommunicationSummary);
              }
            }
            cursor.continue();
          };
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function earliestCommunicationCreatedAt(communications: readonly A2ACommunicationSummaryItemDto[]): number | undefined {
  const timestamps = communications.flatMap(({ createdAt }) =>
    typeof createdAt === "number" && Number.isFinite(createdAt) ? [createdAt] : []);
  return timestamps.length ? Math.min(...timestamps) : undefined;
}

export async function deleteCommunicationSummaries(database: IDBDatabase, threadKey: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(["communications"], "readwrite");
    const store = transaction.objectStore("communications");
    const request = store.index("threadKey").openKeyCursor(IDBKeyRange.only(threadKey));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

export function cacheKey(target: string, provider: AssistantProvider, threadId: string): string {
  return JSON.stringify([target, provider, threadId]);
}

export function groupRange(threadKey: string, firstIndex: number, lastIndex: number): IDBKeyRange {
  return IDBKeyRange.bound([threadKey, firstIndex], [threadKey, Math.max(firstIndex, lastIndex)]);
}
