export type PromptImageAttachment = {
  name: string;
  mimeType: string;
  data: string;
};

export type PromptFileAttachment = {
  name: string;
  mimeType: string;
  content: string;
};

export const PROMPT_FILE_ATTACHMENT_MAX_COUNT = 4;
export const PROMPT_FILE_ATTACHMENT_MAX_BYTES = 512 * 1024;
export const PROMPT_FILE_ATTACHMENTS_MAX_BYTES = 1024 * 1024;

/** Validate and copy attachment values while enforcing the prompt's shared file limits. */
export function validatePromptFileAttachments(value: unknown): PromptFileAttachment[] {
  if (!Array.isArray(value)) throw new Error("File attachments must be a list");
  if (value.length > PROMPT_FILE_ATTACHMENT_MAX_COUNT) throw new Error(`Up to ${PROMPT_FILE_ATTACHMENT_MAX_COUNT} files may be attached per message`);
  let totalBytes = 0;
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`File attachment ${index + 1} is invalid`);
    const record = item as Record<string, unknown>;
    const fields = Object.keys(record);
    if (fields.some((field) => field !== "name" && field !== "mimeType" && field !== "content")) {
      throw new Error(`File attachment ${index + 1} contains unsupported fields`);
    }
    const { name, mimeType, content } = record;
    if (typeof name !== "string" || !name.trim() || name.length > 200) throw new Error(`File attachment ${index + 1} has an invalid filename`);
    if (typeof mimeType !== "string" || !mimeType.trim() || mimeType.length > 128) throw new Error(`File attachment ${name} has an invalid media type`);
    if (typeof content !== "string" || content.includes("\0")) throw new Error(`File attachment ${name} must contain UTF-8 text`);
    const sizeBytes = utf8ByteLength(content);
    if (sizeBytes > PROMPT_FILE_ATTACHMENT_MAX_BYTES) throw new Error(`File attachment ${name} exceeds ${PROMPT_FILE_ATTACHMENT_MAX_BYTES / 1024} KB`);
    totalBytes += sizeBytes;
    if (totalBytes > PROMPT_FILE_ATTACHMENTS_MAX_BYTES) throw new Error(`File attachments cannot exceed ${PROMPT_FILE_ATTACHMENTS_MAX_BYTES / 1024} KB in total`);
    return { name, mimeType, content };
  });
}

function utf8ByteLength(value: string): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) byteLength += 1;
    else if (codeUnit <= 0x7ff) byteLength += 2;
    else {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        byteLength += 4;
        index += 1;
      } else byteLength += 3;
    }
  }
  return byteLength;
}
