import type { AssistantProvider } from "../../shared/bridge";
import { isAssistantProvider } from "../../../../../src/domain/provider-catalog.js";
import { a2aCommunicationGroupKey, type A2ACommunicationSummaryItem } from "../../../../../src/domain/a2a.js";
import type { ThreadView } from "./conversation-view";
import { groupTranscriptResponses, type TranscriptResponseGroup } from "./transcript-groups";

const DATABASE_NAME = "hive-transcript-cache";
const DATABASE_VERSION = 3;
const MIN_CACHED_RESPONSE_GROUPS = 10;

type ThreadViewMetadata = Omit<ThreadView, "entries">;
type CacheMetadata = {
  threadKey: string;
  groupCount: number;
  updatedAt: number;
  sourceUpdatedAt: string | number | null;
  view: ThreadViewMetadata;
};
type CacheGroup = TranscriptResponseGroup & { threadKey: string; index: number };
type CacheCommunicationSummary = {
  threadKey: string;
  summaryId: string;
  communications: A2ACommunicationSummaryItem[];
  updatedAt: number;
  responseTurnId?: string;
};
export type CachedTranscriptPage = {
  groups: TranscriptResponseGroup[];
  firstIndex: number;
  totalGroups: number;
  hasOlder: boolean;
  sourceUpdatedAt: string | number | null;
  view: ThreadViewMetadata;
};

type MemoryThread = { metadata: CacheMetadata; groups: TranscriptResponseGroup[] };

const memoryCache = new Map<string, MemoryThread>();
const memoryCommunicationSummaries = new Map<string, Map<string, CacheCommunicationSummary>>();
const pendingWrites = new Map<string, { view: ThreadView; sourceUpdatedAt: string | number | null }>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
let databasePromise: Promise<IDBDatabase | null> | undefined;

/** Persist provider transcripts locally and expose response-group pages without loading every page. */
export const hiveTranscriptCache = {
  async saveCommunicationSummary(
    target: string,
    provider: AssistantProvider,
    threadId: string,
    summaryId: string,
    communications: A2ACommunicationSummaryItem[],
    responseTurnId?: string,
  ): Promise<void> {
    const threadKey = cacheKey(target, provider, threadId);
    if (!summaryId || !communications.length) return;
    const summaries = memoryCommunicationSummaries.get(threadKey) ?? new Map<string, CacheCommunicationSummary>();
    const currentMemory = summaries.get(summaryId);
    summaries.set(summaryId, mergeCommunicationSummary({
      threadKey,
      summaryId,
      updatedAt: Date.now(),
      communications,
      ...(responseTurnId ? { responseTurnId } : {}),
    }, currentMemory));
    memoryCommunicationSummaries.set(threadKey, summaries);

    const database = await openDatabase();
    if (!database) return;

    await new Promise<void>((resolve) => {
      const transaction = database.transaction(["communications"], "readwrite");
      const store = transaction.objectStore("communications");
      const request = store.get([threadKey, summaryId]) as IDBRequest<CacheCommunicationSummary | undefined>;
      request.onsuccess = () => {
        const current = isCacheCommunicationSummary(request.result) ? request.result : undefined;
        store.put(mergeCommunicationSummary({
          threadKey,
          summaryId,
          updatedAt: Date.now(),
          communications,
          ...(responseTurnId ? { responseTurnId } : {}),
        }, current));
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  },

  async readCommunicationSummaries(
    target: string,
    provider: AssistantProvider,
    threadId: string,
  ): Promise<Array<{ summaryId: string; communications: A2ACommunicationSummaryItem[]; responseTurnId?: string; updatedAt: number }>> {
    const threadKey = cacheKey(target, provider, threadId);
    const database = await openDatabase();
    if (!database) {
      return [...(memoryCommunicationSummaries.get(threadKey)?.values() ?? [])]
        .sort((left, right) => left.updatedAt - right.updatedAt)
        .map(({ summaryId, communications, responseTurnId, updatedAt }) => ({
          summaryId,
          communications,
          ...(responseTurnId ? { responseTurnId } : {}),
          updatedAt,
        }));
    }

    const records = await new Promise<CacheCommunicationSummary[]>((resolve) => {
      const transaction = database.transaction(["communications"], "readonly");
      const request = transaction.objectStore("communications").index("threadKey")
        .getAll(IDBKeyRange.only(threadKey)) as IDBRequest<unknown[]>;
      request.onsuccess = () => resolve(Array.isArray(request.result)
        ? request.result.filter(isCacheCommunicationSummary)
        : []);
      transaction.onerror = () => resolve([]);
    });
    const mergedRecords = new Map(records.map((record) => [record.summaryId, record]));
    for (const record of memoryCommunicationSummaries.get(threadKey)?.values() ?? []) {
      mergedRecords.set(record.summaryId, mergeCommunicationSummary(record, mergedRecords.get(record.summaryId)));
    }
    return [...mergedRecords.values()]
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .map(({ summaryId, communications, responseTurnId, updatedAt }) => ({
        summaryId,
        communications,
        ...(responseTurnId ? { responseTurnId } : {}),
        updatedAt,
      }));
  },

  async clearCommunicationSummaries(target: string, provider: AssistantProvider, threadId: string): Promise<void> {
    const threadKey = cacheKey(target, provider, threadId);
    memoryCommunicationSummaries.delete(threadKey);
    const database = await openDatabase();
    if (!database) return;
    await deleteCommunicationSummaries(database, threadKey);
  },

  async readLatest(target: string, provider: AssistantProvider, threadId: string, limit: number): Promise<CachedTranscriptPage | undefined> {
    const threadKey = cacheKey(target, provider, threadId);
    const database = await openDatabase();
    if (!database) return memoryLatest(threadKey, limit);

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
        if (metadata.groupCount < MIN_CACHED_RESPONSE_GROUPS) {
          resolve(undefined);
          return;
        }
        const firstIndex = Math.max(0, metadata.groupCount - limit);
        const recordsRequest = transaction.objectStore("groups").getAll(groupRange(threadKey, firstIndex, metadata.groupCount - 1)) as IDBRequest<CacheGroup[]>;
        recordsRequest.onsuccess = () => {
          const records: unknown = recordsRequest.result;
          resolve(Array.isArray(records) && records.every(isCacheGroup) ? toPage(metadata, records) : undefined);
        };
      };
      transaction.onerror = () => resolve(undefined);
    });
  },

  async readOlder(
    target: string,
    provider: AssistantProvider,
    threadId: string,
    beforeGroupId: string,
    limit: number,
  ): Promise<{ groups: TranscriptResponseGroup[]; firstIndex: number; hasOlder: boolean }> {
    const threadKey = cacheKey(target, provider, threadId);
    const database = await openDatabase();
    if (!database) return memoryOlder(threadKey, beforeGroupId, limit);

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
  },

  async replaceAll(view: ThreadView, sourceUpdatedAt: string | number | null): Promise<void> {
    const threadKey = cacheKey(view.target, view.provider, view.threadId);
    const groups = groupTranscriptResponses(view.entries);
    const metadata: CacheMetadata = {
      threadKey,
      groupCount: groups.length,
      updatedAt: Date.now(),
      sourceUpdatedAt,
      view: metadataFromView(view),
    };
    const database = await openDatabase();
    if (!database) {
      memoryCache.set(threadKey, { metadata, groups });
      return;
    }

    try {
      const saved = await new Promise<boolean>((resolve) => {
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
      if (saved) memoryCache.delete(threadKey);
    } catch { /* A cache write must not block opening a provider conversation. */ }
  },

  /** Debounce streaming updates; each flush only touches response groups in the active transcript window. */
  saveRecent(view: ThreadView, sourceUpdatedAt: string | number | null = null): void {
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
    memoryCache.delete(threadKey);
    memoryCommunicationSummaries.delete(threadKey);
    pendingWrites.delete(threadKey);
    const timer = writeTimers.get(threadKey);
    if (timer) clearTimeout(timer);
    writeTimers.delete(threadKey);
    const database = await openDatabase();
    if (!database) return;
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
    await deleteCommunicationSummaries(database, threadKey);
  },

  async hasOlder(target: string, provider: AssistantProvider, threadId: string, firstGroupId: string): Promise<boolean> {
    const page = await this.readOlder(target, provider, threadId, firstGroupId, 1);
    return page.groups.length > 0;
  },

  async mergeRecent(threadKey: string, view: ThreadView, sourceUpdatedAt: string | number | null): Promise<void> {
    const groups = groupTranscriptResponses(view.entries);
    if (!groups.length) {
      await this.replaceAll(view, sourceUpdatedAt);
      return;
    }
    const database = await openDatabase();
    if (!database) {
      const current = memoryCache.get(threadKey);
      if (!current) {
        memoryCache.set(threadKey, {
          metadata: { threadKey, groupCount: groups.length, updatedAt: Date.now(), sourceUpdatedAt, view: metadataFromView(view) },
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
      return;
    }

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
          view: metadataFromView(view),
        } satisfies CacheMetadata;
        const upsertGroup = (groupIndex: number) => {
          if (groupIndex >= groups.length) {
            metadataStore.put({
              ...current,
              groupCount: current.groupCount,
              updatedAt: Date.now(),
              sourceUpdatedAt: sourceUpdatedAt ?? current.sourceUpdatedAt,
              view: metadataFromView(view),
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
  },
};

function openDatabase(): Promise<IDBDatabase | null> {
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

function mergeCommunicationSummary(
  incoming: CacheCommunicationSummary,
  current?: CacheCommunicationSummary,
): CacheCommunicationSummary {
  const communications = new Map<string, A2ACommunicationSummaryItem>();
  for (const communication of current?.communications ?? []) {
    communications.set(JSON.stringify([communication.taskId, communication.kind]), communication);
  }
  for (const communication of incoming.communications) {
    communications.set(JSON.stringify([communication.taskId, communication.kind]), communication);
  }
  const responseTurnId = incoming.responseTurnId ?? current?.responseTurnId;
  return {
    ...incoming,
    ...(responseTurnId ? { responseTurnId } : {}),
    communications: [...communications.values()],
  };
}

function isCacheCommunicationSummary(value: unknown): value is CacheCommunicationSummary {
  return isRecord(value) && typeof value.threadKey === "string" && typeof value.summaryId === "string" &&
    value.summaryId.length > 0 && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) &&
    (value.responseTurnId === undefined || typeof value.responseTurnId === "string") &&
    Array.isArray(value.communications) && value.communications.length > 0 && value.communications.every((communication) =>
      isRecord(communication) && (communication.kind === "request" || communication.kind === "result") &&
      typeof communication.taskId === "string" && communication.taskId.length > 0 &&
      typeof communication.sourceAgentId === "string" && communication.sourceAgentId.length > 0 &&
      typeof communication.message === "string" &&
      (communication.sourceSessionName === undefined || typeof communication.sourceSessionName === "string"));
}

async function deleteCommunicationSummaries(database: IDBDatabase, threadKey: string): Promise<void> {
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

function cacheKey(target: string, provider: AssistantProvider, threadId: string): string {
  return JSON.stringify([target, provider, threadId]);
}

function groupRange(threadKey: string, firstIndex: number, lastIndex: number): IDBKeyRange {
  return IDBKeyRange.bound([threadKey, firstIndex], [threadKey, Math.max(firstIndex, lastIndex)]);
}

function toPage(metadata: CacheMetadata, records: CacheGroup[]): CachedTranscriptPage {
  return {
    groups: records.map(({ id, entries }) => ({ id, entries })),
    firstIndex: records[0]?.index ?? metadata.groupCount,
    totalGroups: metadata.groupCount,
    hasOlder: (records[0]?.index ?? metadata.groupCount) > 0,
    sourceUpdatedAt: metadata.sourceUpdatedAt,
    view: metadata.view,
  };
}

function metadataFromView(view: ThreadView): ThreadViewMetadata {
  const { entries: _entries, ...metadata } = view;
  return metadata;
}

function isCacheMetadata(value: unknown): value is CacheMetadata {
  if (!isRecord(value) || typeof value.threadKey !== "string" || typeof value.groupCount !== "number" || !Number.isInteger(value.groupCount) || value.groupCount < 0) return false;
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || !(value.sourceUpdatedAt === null || typeof value.sourceUpdatedAt === "string" || (typeof value.sourceUpdatedAt === "number" && Number.isFinite(value.sourceUpdatedAt)))) return false;
  const view = value.view;
  return isRecord(view) &&
    typeof view.target === "string" && typeof view.threadId === "string" && isAssistantProvider(view.provider) &&
    typeof view.title === "string" && typeof view.cwd === "string" && typeof view.model === "string" &&
    (view.effort === null || typeof view.effort === "string") &&
    (view.permissionProfile === null || typeof view.permissionProfile === "string") &&
    Array.isArray(view.modes) && view.modes.every(isRemoteMode) &&
    Array.isArray(view.skills) && view.skills.every(isRemoteSkill) && Array.isArray(view.skillWarnings) &&
    view.skillWarnings.every((warning) => typeof warning === "string") &&
    (view.currentModeId === null || typeof view.currentModeId === "string");
}

function isCacheGroup(value: unknown): value is CacheGroup {
  return isRecord(value) && typeof value.threadKey === "string" && typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0 &&
    typeof value.id === "string" && Array.isArray(value.entries) && value.entries.every(isTranscriptEntry) &&
    value.entries[0]?.id === value.id;
}

function isRemoteMode(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.description === "string";
}

function isRemoteSkill(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
    typeof value.description === "string" && typeof value.provider === "string" &&
    typeof value.scope === "string" && typeof value.enabled === "boolean";
}

function isTranscriptEntry(value: unknown): value is ThreadView["entries"][number] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") return false;
  if (value.role !== "user" && value.role !== "assistant" && value.role !== "tool" && value.role !== "change" && value.role !== "communication") return false;
  if (value.role === "communication" && (!Array.isArray(value.communications) || value.communications.length === 0 || value.communications.some((communication) =>
    !isRecord(communication) ||
    (communication.kind !== "request" && communication.kind !== "result") ||
    typeof communication.taskId !== "string" || typeof communication.sourceAgentId !== "string" || typeof communication.message !== "string" ||
    (communication.sourceSessionName !== undefined && typeof communication.sourceSessionName !== "string")))) return false;
  if (value.turnId !== undefined && typeof value.turnId !== "string") return false;
  if (value.providerMessageId !== undefined && typeof value.providerMessageId !== "string") return false;
  if (value.responseDurationMs !== undefined && (typeof value.responseDurationMs !== "number" || !Number.isFinite(value.responseDurationMs) || value.responseDurationMs < 0)) return false;
  if (value.status !== undefined && typeof value.status !== "string") return false;
  if (value.responseCompleted !== undefined && typeof value.responseCompleted !== "boolean") return false;
  if (value.images !== undefined && (!Array.isArray(value.images) || value.images.some((image) =>
    !isRecord(image) || typeof image.name !== "string" || typeof image.mimeType !== "string" || typeof image.data !== "string"))) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function memoryLatest(threadKey: string, limit: number): CachedTranscriptPage | undefined {
  const current = memoryCache.get(threadKey);
  if (!current || current.groups.length < MIN_CACHED_RESPONSE_GROUPS) return undefined;
  const firstIndex = Math.max(0, current.groups.length - limit);
  const groups = current.groups.slice(firstIndex);
  return {
    groups,
    firstIndex,
    totalGroups: current.groups.length,
    hasOlder: firstIndex > 0,
    sourceUpdatedAt: current.metadata.sourceUpdatedAt,
    view: current.metadata.view,
  };
}

function memoryOlder(threadKey: string, beforeGroupId: string, limit: number): { groups: TranscriptResponseGroup[]; firstIndex: number; hasOlder: boolean } {
  const groups = memoryCache.get(threadKey)?.groups ?? [];
  const beforeIndex = groups.findIndex((group) => group.id === beforeGroupId);
  if (beforeIndex <= 0) return { groups: [], firstIndex: Math.max(0, beforeIndex), hasOlder: false };
  const firstIndex = Math.max(0, beforeIndex - limit);
  return { groups: groups.slice(firstIndex, beforeIndex), firstIndex, hasOlder: firstIndex > 0 };
}
