import { useState } from "react";
import type { AssistantProvider } from "../../../shared/bridge";
import { assistantProviderSupports } from "../../../../../../src/domain/provider-catalog.js";
import type { ThreadViewStore } from "./thread-view-store";
import type { ConversationRuntime } from "./useConversationRuntime";
import type { LocalImageAttachment } from "./session-state";

export function useImageAttachments({ state, runtime, threadViews, setters }: {
  state: {
    provider: AssistantProvider;
    busy: boolean;
    target: string;
    threadId: string;
  };
  runtime: ConversationRuntime;
  threadViews: ThreadViewStore;
  setters: {
    setDraft(update: (current: string) => string): void;
    setNotice(notice: string): void;
  };
}) {
  const [attachments, setAttachments] = useState<LocalImageAttachment[]>([]);

  const addImages = async (files: File[]) => {
    if (!assistantProviderSupports(state.provider, "images") || state.busy || !state.target || !state.threadId) return;
    const next = [...(threadViews.getImageAttachments(state.target, state.provider, state.threadId) ?? attachments)];
    let totalBytes = next.reduce((total, image) => total + Math.max(0, Math.floor(image.data.length * 3 / 4) - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0)), 0);
    const skipped: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/") || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type.toLowerCase())) {
        skipped.push(`${file.name}: 지원하지 않는 이미지 형식`);
        continue;
      }
      if (next.length >= 4 || file.size > 4 * 1024 * 1024 || totalBytes + file.size > 8 * 1024 * 1024) {
        skipped.push(`${file.name}: 이미지 최대 4개, 파일당 4MB, 전체 8MB까지 첨부할 수 있습니다.`);
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        next.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name.slice(0, 200), mimeType: file.type.toLowerCase(), data: btoa(binary) });
        totalBytes += file.size;
      } catch {
        skipped.push(`${file.name}: 이미지를 읽지 못했습니다.`);
      }
    }
    threadViews.setImageAttachments(state.target, state.provider, state.threadId, next);
    if (runtime.isThreadSelected(state.target, state.provider, state.threadId)) {
      setAttachments(next);
      if (next.length) setters.setDraft((current) => current.trim() ? current : "첨부한 이미지를 확인해 주세요.");
      setters.setNotice(skipped.length ? skipped.join(" · ") : "");
    }
  };

  const removeImage = (attachmentId: string) => {
    if (!state.target || !state.threadId) return;
    const next = (threadViews.getImageAttachments(state.target, state.provider, state.threadId) ?? attachments).filter((image) => image.id !== attachmentId);
    threadViews.setImageAttachments(state.target, state.provider, state.threadId, next);
    setAttachments(next);
    if (!next.length) setters.setDraft((current) => current === "첨부한 이미지를 확인해 주세요." ? "" : current);
  };

  return { attachments, setAttachments, addImages, removeImage };
}
