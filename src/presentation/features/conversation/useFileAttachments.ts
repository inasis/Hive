import { useRef, useState } from "react";
import type { AssistantProvider } from "../../shared/bridge";
import {
  PROMPT_FILE_ATTACHMENT_MAX_BYTES,
  PROMPT_FILE_ATTACHMENT_MAX_COUNT,
  PROMPT_FILE_ATTACHMENTS_MAX_BYTES,
} from "../../../domain/prompt-attachments.js";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import type { ThreadViewStorePort, ConversationRuntimePort } from "../../shared/conversation-store";
import type { LocalFileAttachment } from "../../shared/conversation-view";
import { extractPromptFileContent } from "./file-content-extractor.js";

export function useFileAttachments({ state, runtime, threadViews, setters }: {
  state: {
    provider: AssistantProvider;
    busy: boolean;
    target: string;
    threadId: string;
  };
  runtime: ConversationRuntimePort;
  threadViews: ThreadViewStorePort;
  setters: {
    setDraft(update: (current: string) => string): void;
    setNotice(notice: string): void;
  };
}) {
  const [attachments, setAttachments] = useState<LocalFileAttachment[]>([]);
  const readingFiles = useRef(false);

  const addFiles = async (files: File[]) => {
    if (!assistantProviderSupports(state.provider, "fileAttachments") || state.busy || !state.target || !state.threadId || !files.length) return;
    if (readingFiles.current) {
      setters.setNotice("파일을 읽는 중입니다. 잠시 기다려 주세요.");
      return;
    }
    readingFiles.current = true;
    const target = state.target;
    const provider = state.provider;
    const threadId = state.threadId;
    const next = [...(threadViews.getFileAttachments(target, provider, threadId) ?? attachments)];
    let totalBytes = next.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0);
    const skipped: string[] = [];
    try {
      for (const file of files) {
        if (next.length >= PROMPT_FILE_ATTACHMENT_MAX_COUNT || file.size > PROMPT_FILE_ATTACHMENT_MAX_BYTES || totalBytes + file.size > PROMPT_FILE_ATTACHMENTS_MAX_BYTES) {
          skipped.push(`${file.name}: 파일은 최대 ${PROMPT_FILE_ATTACHMENT_MAX_COUNT}개, 파일당 ${PROMPT_FILE_ATTACHMENT_MAX_BYTES / 1024} KB, 전체 ${PROMPT_FILE_ATTACHMENTS_MAX_BYTES / 1024} KB까지 첨부할 수 있습니다.`);
          continue;
        }
        try {
          const content = await extractPromptFileContent(file);
          const name = file.name.trim().slice(0, 200);
          if (!name) {
            skipped.push("이름이 없는 파일은 첨부할 수 없습니다.");
            continue;
          }
          const mimeType = (file.type || "text/plain").trim().slice(0, 128) || "text/plain";
          const sizeBytes = new TextEncoder().encode(content).byteLength;
          if (totalBytes + sizeBytes > PROMPT_FILE_ATTACHMENTS_MAX_BYTES) {
            skipped.push(`${file.name}: 전체 첨부 내용은 ${PROMPT_FILE_ATTACHMENTS_MAX_BYTES / 1024} KB까지 가능합니다.`);
            continue;
          }
          next.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, mimeType, content });
          totalBytes += sizeBytes;
        } catch (error) {
          const message = error instanceof Error ? error.message : "지원하지 않는 파일 형식입니다.";
          skipped.push(`${file.name}: ${message}`);
        }
      }
    } finally {
      readingFiles.current = false;
    }
    threadViews.setFileAttachments(target, provider, threadId, next);
    if (runtime.isThreadSelected(target, provider, threadId)) {
      setAttachments(next);
      if (next.length) setters.setDraft((current) => current.trim() ? current : "첨부한 파일을 확인해 주세요.");
      setters.setNotice(skipped.length ? skipped.join(" · ") : "");
    }
  };

  const removeFile = (attachmentId: string) => {
    if (!state.target || !state.threadId) return;
    const next = (threadViews.getFileAttachments(state.target, state.provider, state.threadId) ?? attachments)
      .filter((file) => file.id !== attachmentId);
    threadViews.setFileAttachments(state.target, state.provider, state.threadId, next);
    setAttachments(next);
    if (!next.length) setters.setDraft((current) => current === "첨부한 파일을 확인해 주세요." ? "" : current);
  };

  return { attachments, setAttachments, addFiles, removeFile };
}
