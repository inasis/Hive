import type {
  WorkspaceFileItemDto,
  WorkspaceFileListingDto,
  WorkspaceFileTextDto,
  WorkspaceFileWriteDto,
} from "../../application/dto/workspace.js";

/** Validate untrusted results returned by remote workspace operations. */
export function parseWorkspaceFileListing(value: unknown): WorkspaceFileListingDto {
  const record = asRecord(value);
  if (!record || typeof record.path !== "string" || !Array.isArray(record.items)) {
    throw new Error("Remote workspace returned an invalid directory listing");
  }
  const items = record.items.map((value): WorkspaceFileItemDto => {
    if (!isWorkspaceFileItem(value)) {
      throw new Error("Remote workspace returned an invalid directory listing");
    }
    return { name: value.name, path: value.path, kind: value.kind, size: value.size };
  });
  return { path: record.path, items };
}

export function parseWorkspaceFileText(value: unknown): WorkspaceFileTextDto {
  const record = asRecord(value);
  if (!record || typeof record.path !== "string" || typeof record.content !== "string" ||
      !isNonNegativeInteger(record.bytes) || record.bytes !== Buffer.byteLength(record.content, "utf8")) {
    throw new Error("Remote workspace returned an invalid file preview");
  }
  return { path: record.path, content: record.content, bytes: record.bytes };
}

export function parseWorkspaceFileWrite(value: unknown): WorkspaceFileWriteDto {
  const record = asRecord(value);
  if (!record || typeof record.path !== "string" || record.written !== true || !isNonNegativeInteger(record.bytes)) {
    throw new Error("Remote workspace returned an invalid file write result");
  }
  return { path: record.path, written: true, bytes: record.bytes };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isWorkspaceFileItem(value: unknown): value is WorkspaceFileItemDto {
  const item = asRecord(value);
  if (!item || typeof item.name !== "string" || typeof item.path !== "string") return false;
  if (item.kind === "directory") return item.size === null;
  return item.kind === "file" && isNonNegativeInteger(item.size);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
