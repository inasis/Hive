import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import type { AssistantProvider } from "../../shared/bridge";
import type { SlashMenuItem } from "../../shared/slash-menu";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";

type ComposerInputOptions = {
  provider: AssistantProvider;
  busy: boolean;
  slashMenuOpen: boolean;
  slashItems: SlashMenuItem[];
  slashSkillIndex: number;
  onSlashSkillIndexChange: (update: (current: number) => number) => void;
  slashSkillLoading: boolean;
  onDraftChange: (draft: string) => void;
  onSendPrompt: () => void;
  onChooseSlashMenuItem: (item: SlashMenuItem) => void;
  onAddImages: (files: File[]) => void;
  onAddFiles: (files: File[]) => void;
};

export function useComposerInput({
  provider,
  busy,
  slashMenuOpen,
  slashItems,
  slashSkillIndex,
  onSlashSkillIndexChange,
  slashSkillLoading,
  onDraftChange,
  onSendPrompt,
  onChooseSlashMenuItem,
  onAddImages,
  onAddFiles,
}: ComposerInputOptions) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supportsImages = assistantProviderSupports(provider, "images");
  const supportsFileAttachments = assistantProviderSupports(provider, "fileAttachments");

  const chooseSlashMenuItem = (item: SlashMenuItem) => {
    onChooseSlashMenuItem(item);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen) {
      if (event.key === "ArrowDown" && slashItems.length) {
        event.preventDefault();
        onSlashSkillIndexChange((index) => (index + 1) % slashItems.length);
        return;
      }
      if (event.key === "ArrowUp" && slashItems.length) {
        event.preventDefault();
        onSlashSkillIndexChange((index) => (index + slashItems.length - 1) % slashItems.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onDraftChange("");
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const item = slashItems[slashSkillIndex];
        if (item) chooseSlashMenuItem(item);
        else if (!slashSkillLoading) onSendPrompt();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSendPrompt();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (busy) return;
    const files = Array.from(event.clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return [];
      const file = item.getAsFile();
      return file ? [file] : [];
    });
    const images = supportsImages ? files.filter((file) => file.type.startsWith("image/")) : [];
    const textFiles = supportsFileAttachments ? files.filter((file) => !file.type.startsWith("image/")) : [];
    if (images.length || textFiles.length) {
      event.preventDefault();
      if (images.length) onAddImages(images);
      if (textFiles.length) onAddFiles(textFiles);
    }
  };

  return { textareaRef, handleKeyDown, handlePaste, chooseSlashMenuItem };
}
