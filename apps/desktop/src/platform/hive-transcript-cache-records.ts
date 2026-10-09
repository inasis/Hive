import type { A2ACommunicationSummaryItemDto } from "../../../../src/application/dto/a2a-communication.js";
import { isAssistantProvider } from "../../../../src/domain/provider-catalog.js";
import type { TranscriptCacheViewDto, TranscriptResponseGroupDto, TranscriptEntryDto } from "../../../../src/application/dto/transcript-cache.js";

export type ThreadViewMetadata = Omit<TranscriptCacheViewDto, "entries">;

export type CacheMetadata = {
  threadKey: string;
  groupCount: number;
  updatedAt: number;
  sourceUpdatedAt: string | number | null;
  view: ThreadViewMetadata;
};

export type CacheGroup = TranscriptResponseGroupDto & { threadKey: string; index: number };

export type CacheCommunicationSummary = {
  threadKey: string;
  summaryId: string;
  communications: A2ACommunicationSummaryItemDto[];
  updatedAt: number;
  createdAt?: number;
  responseTurnId?: string;
};

export function isCacheCommunicationSummary(value: unknown): value is CacheCommunicationSummary {
  return isRecord(value) && typeof value.threadKey === "string" && typeof value.summaryId === "string" &&
    value.summaryId.length > 0 && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) &&
    (value.createdAt === undefined || (typeof value.createdAt === "number" && Number.isFinite(value.createdAt))) &&
    (value.responseTurnId === undefined || typeof value.responseTurnId === "string") &&
    Array.isArray(value.communications) && value.communications.length > 0 && value.communications.every((communication) =>
      isRecord(communication) && (communication.kind === "request" || communication.kind === "result") &&
      typeof communication.taskId === "string" && communication.taskId.length > 0 &&
      typeof communication.sourceAgentId === "string" && communication.sourceAgentId.length > 0 &&
      typeof communication.message === "string" &&
      (communication.createdAt === undefined || (typeof communication.createdAt === "number" && Number.isFinite(communication.createdAt))) &&
      (communication.sourceSessionName === undefined || typeof communication.sourceSessionName === "string"));
}

export function isCacheMetadata(value: unknown): value is CacheMetadata {
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

export function isCacheGroup(value: unknown): value is CacheGroup {
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

function isTranscriptEntry(value: unknown): value is TranscriptEntryDto {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") return false;
  if (value.role !== "user" && value.role !== "assistant" && value.role !== "tool" && value.role !== "change" && value.role !== "communication") return false;
  if (value.createdAt !== undefined && (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt))) return false;
  if (value.role === "communication" && (!Array.isArray(value.communications) || value.communications.length === 0 || value.communications.some((communication) =>
    !isRecord(communication) ||
    (communication.kind !== "request" && communication.kind !== "result") ||
    typeof communication.taskId !== "string" || typeof communication.sourceAgentId !== "string" || typeof communication.message !== "string" ||
    (communication.createdAt !== undefined && (typeof communication.createdAt !== "number" || !Number.isFinite(communication.createdAt))) ||
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
