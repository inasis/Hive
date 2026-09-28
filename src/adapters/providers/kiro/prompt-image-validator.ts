import type { PromptImageAttachment } from "../../../domain/assistant.js";
import { asObject, firstString } from "./session-utils.js";

export function validateKiroPromptImages(value: unknown): PromptImageAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Kiro image attachments must be a list");
  if (value.length > 4) throw new Error("Kiro accepts up to four images per message");
  let totalBytes = 0;
  return value.map((item, index) => {
    const image = asObject(item);
    const name = firstString(image?.name);
    const mimeType = firstString(image?.mimeType)?.toLowerCase();
    const data = typeof image?.data === "string" ? image.data : "";
    if (!image || !name || name.length > 200) throw new Error(`Kiro image ${index + 1} has an invalid filename`);
    if (!mimeType || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType)) {
      throw new Error(`Kiro image ${name} must be PNG, JPEG, GIF, or WebP`);
    }
    if (!data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error(`Kiro image ${name} has invalid base64 data`);
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    const sizeBytes = Math.floor(data.length * 3 / 4) - padding;
    if (sizeBytes <= 0 || sizeBytes > 4 * 1024 * 1024) throw new Error(`Kiro image ${name} must be 4 MB or smaller`);
    totalBytes += sizeBytes;
    if (totalBytes > 8 * 1024 * 1024) throw new Error("Kiro image attachments cannot exceed 8 MB in total");
    return { name, mimeType, data };
  });
}
