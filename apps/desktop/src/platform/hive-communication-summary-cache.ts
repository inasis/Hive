import type { A2ACommunicationSummaryItemDto } from "../../../../src/application/dto/a2a-communication.js";
import type { AssistantProvider } from "../../../../src/domain/provider-catalog.js";
import type {
  CommunicationSummaryCachePort,
} from "../../../../src/application/ports/transcript-cache.js";
import type { CachedCommunicationSummaryDto } from "../../../../src/application/dto/transcript-cache.js";
import { cacheKey, deleteCommunicationSummaries, openTranscriptDatabase } from "./hive-transcript-database.js";
import { isCacheCommunicationSummary, type CacheCommunicationSummary } from "./hive-transcript-cache-records.js";

const memoryCommunicationSummaries = new Map<string, Map<string, CacheCommunicationSummary>>();

/** Persist A2A communication summaries independently from transcript page caching. */
export const hiveCommunicationSummaryCache: CommunicationSummaryCachePort = {
  async saveCommunicationSummary(
    target: string,
    provider: AssistantProvider,
    threadId: string,
    summaryId: string,
    communications: A2ACommunicationSummaryItemDto[],
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
      createdAt: earliestCommunicationCreatedAt(communications) ?? currentMemory?.createdAt,
      communications,
      ...(responseTurnId ? { responseTurnId } : {}),
    }, currentMemory));
    memoryCommunicationSummaries.set(threadKey, summaries);

    const database = await openTranscriptDatabase();
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
          createdAt: earliestCommunicationCreatedAt(communications) ?? current?.createdAt,
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
  ): Promise<CachedCommunicationSummaryDto[]> {
    const threadKey = cacheKey(target, provider, threadId);
    const database = await openTranscriptDatabase();
    if (!database) {
      return [...(memoryCommunicationSummaries.get(threadKey)?.values() ?? [])]
        .sort((left, right) => summaryCreatedAt(left) - summaryCreatedAt(right))
        .map(toCachedSummary);
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
      .sort((left, right) => summaryCreatedAt(left) - summaryCreatedAt(right))
      .map(toCachedSummary);
  },

  async clearCommunicationSummaries(target: string, provider: AssistantProvider, threadId: string): Promise<void> {
    const threadKey = cacheKey(target, provider, threadId);
    memoryCommunicationSummaries.delete(threadKey);
    const database = await openTranscriptDatabase();
    if (!database) return;
    await deleteCommunicationSummaries(database, threadKey);
  },
};

function toCachedSummary({ summaryId, communications, responseTurnId, createdAt, updatedAt }: CacheCommunicationSummary): CachedCommunicationSummaryDto {
  return {
    summaryId,
    communications,
    ...(responseTurnId ? { responseTurnId } : {}),
    createdAt: createdAt ?? earliestCommunicationCreatedAt(communications) ?? updatedAt,
    updatedAt,
  };
}

function mergeCommunicationSummary(
  incoming: CacheCommunicationSummary,
  current?: CacheCommunicationSummary,
): CacheCommunicationSummary {
  const communications = new Map<string, A2ACommunicationSummaryItemDto>();
  for (const communication of current?.communications ?? []) {
    communications.set(JSON.stringify([communication.taskId, communication.kind]), communication);
  }
  for (const communication of incoming.communications) {
    communications.set(JSON.stringify([communication.taskId, communication.kind]), communication);
  }
  const responseTurnId = incoming.responseTurnId ?? current?.responseTurnId;
  const createdAt = earliestCommunicationCreatedAt([...communications.values()]);
  const storedCreatedAt = [createdAt, incoming.createdAt, current?.createdAt]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    ...incoming,
    createdAt: storedCreatedAt.length ? Math.min(...storedCreatedAt) : incoming.updatedAt,
    ...(responseTurnId ? { responseTurnId } : {}),
    communications: [...communications.values()],
  };
}

function earliestCommunicationCreatedAt(communications: readonly A2ACommunicationSummaryItemDto[]): number | undefined {
  const timestamps = communications.flatMap(({ createdAt }) =>
    typeof createdAt === "number" && Number.isFinite(createdAt) ? [createdAt] : []);
  return timestamps.length ? Math.min(...timestamps) : undefined;
}

function summaryCreatedAt(summary: CacheCommunicationSummary): number {
  return summary.createdAt ?? earliestCommunicationCreatedAt(summary.communications) ?? summary.updatedAt;
}
