import type { TranscriptEntry } from "../../domain/assistant.js";
import { groupTranscriptResponses } from "../../domain/transcript.js";
import type { TranscriptEntryDto, TranscriptResponseGroupDto } from "../dto/transcript-cache.js";

/** Group transcript cache DTOs with the Domain ordering rule and copy the result back to DTOs. */
export function groupTranscriptResponseDtos(entries: readonly TranscriptEntryDto[]): TranscriptResponseGroupDto[] {
  const domainEntries = entries.map(toDomainTranscriptEntry);
  return groupTranscriptResponses(domainEntries).map(({ id, entries: groupEntries }) => ({
    id,
    entries: groupEntries.map(toTranscriptEntryDto),
  }));
}

function toDomainTranscriptEntry(entry: TranscriptEntryDto): TranscriptEntry {
  return {
    ...entry,
    ...(entry.communications ? { communications: entry.communications.map((communication) => ({ ...communication })) } : {}),
    ...(entry.images ? { images: entry.images.map((image) => ({ ...image })) } : {}),
  };
}

function toTranscriptEntryDto(entry: TranscriptEntry): TranscriptEntryDto {
  return {
    ...entry,
    ...(entry.communications ? { communications: entry.communications.map((communication) => ({ ...communication })) } : {}),
    ...(entry.images ? { images: entry.images.map((image) => ({ ...image })) } : {}),
  };
}
