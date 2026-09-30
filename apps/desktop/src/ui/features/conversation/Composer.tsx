import { useRef, type KeyboardEvent } from "react";
import { Icon } from "../../shared/Icon";
import { effortLabel } from "../../shared/effort-label";
import type { LocalImageAttachment } from "../../shared/conversation-view";
import type { SlashMenuItem } from "../../shared/slash-menu";
import type { AssistantProvider, RemoteCommand, RemoteModel, RemoteSkill } from "../../../shared/bridge";
import { assistantProviderSupports } from "../../../../../../src/domain/provider-catalog.js";

export function Composer({
  provider,
  providerName,
  connectionState,
  activeThreadId,
  openingThread,
  busy,
  stoppingTurn,
  steeringPrompt,
  draft,
  onDraftChange,
  onSendPrompt,
  onStopTurn,
  notice,
  onClearNotice,
  selectedSkill,
  onClearSelectedSkill,
  slashMenuOpen,
  slashItems,
  slashSkillIndex,
  onSlashSkillIndexChange,
  slashSkillLoading,
  skillWarnings,
  skills,
  slashCommands,
  onChooseSlashMenuItem,
  imageAttachments,
  onAddImages,
  onRemoveImage,
  currentModel,
  selectedModel,
  displayedEffort,
  modelSettingsDialogOpen,
  onOpenModelSettings,
}: {
  provider: AssistantProvider;
  providerName: string;
  connectionState: "disconnected" | "connecting" | "connected";
  activeThreadId: string;
  openingThread: boolean;
  busy: boolean;
  stoppingTurn: boolean;
  steeringPrompt: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSendPrompt: () => void;
  onStopTurn: () => void;
  notice: string;
  onClearNotice: () => void;
  selectedSkill: RemoteSkill | null;
  onClearSelectedSkill: () => void;
  slashMenuOpen: boolean;
  slashItems: SlashMenuItem[];
  slashSkillIndex: number;
  onSlashSkillIndexChange: (update: (current: number) => number) => void;
  slashSkillLoading: boolean;
  skillWarnings: string[];
  skills: RemoteSkill[];
  slashCommands: RemoteCommand[];
  onChooseSlashMenuItem: (item: SlashMenuItem) => void;
  imageAttachments: LocalImageAttachment[];
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  currentModel: string;
  selectedModel?: RemoteModel;
  displayedEffort: string;
  modelSettingsDialogOpen: boolean;
  onOpenModelSettings: () => void;
}) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const supportsImages = assistantProviderSupports(provider, "images");
  const supportsTurnSteering = assistantProviderSupports(provider, "turnSteering");

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

  const chooseSlashMenuItem = (item: SlashMenuItem) => {
    onChooseSlashMenuItem(item);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <div className="composer-area">
      {notice && <div className="inline-notice" role="status"><Icon name="info" />{notice}<button className="icon-button" onClick={onClearNotice}><Icon name="close" /></button></div>}
      <div className="composer-wrap">
        {selectedSkill && <div className="selected-skill-chip"><span>{selectedSkill.provider}</span><b>{selectedSkill.name}</b><button type="button" aria-label="선택한 스킬 해제" title="스킬 해제" onClick={onClearSelectedSkill}><Icon name="close" /></button></div>}
        {slashMenuOpen && <div className="slash-skill-menu" role="listbox" aria-label="현재 세션에서 사용할 수 있는 명령과 스킬" aria-activedescendant={slashItems[slashSkillIndex] ? `slash-skill-${slashSkillIndex}` : undefined}>
          <div className="slash-skill-heading"><b>현재 세션 명령 및 스킬</b><small>{slashSkillLoading ? "목록 새로고침 중…" : `${slashItems.length}개`}</small></div>
          {slashItems.map((item, index) => {
            const label = item.kind === "command" ? `/${item.command.name}` : item.skill.name;
            const description = item.kind === "command" ? item.command.description : item.skill.description || item.skill.id;
            const itemProvider = item.kind === "command" ? `${item.command.provider} · 명령` : item.skill.provider;
            const key = item.kind === "command" ? `${item.command.provider}:command:${item.command.name}` : `${item.skill.provider}:skill:${item.skill.id}`;
            return <button key={key} id={`slash-skill-${index}`} type="button" role="option" aria-selected={index === slashSkillIndex} className={`slash-skill-option ${index === slashSkillIndex ? "active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSlashMenuItem(item)}>
              <span className="slash-skill-glyph">{item.kind === "command" ? "›" : "/"}</span><span className="slash-skill-copy"><b>{label}</b><small>{description || (item.kind === "command" && item.command.takesArguments ? "명령 인자를 입력할 수 있습니다." : "")}</small></span><span className="slash-skill-provider">{itemProvider}</span>
            </button>;
          })}
          {!slashSkillLoading && !slashItems.length && <div className="slash-skill-empty">{skillWarnings.length ? skillWarnings[0] : skills.length || slashCommands.length ? "일치하는 명령 또는 스킬이 없습니다." : "현재 세션에서 사용할 수 있는 명령과 스킬이 없습니다."}</div>}
        </div>}
        {supportsImages && <div className="composer-image-control"><input ref={imageInputRef} className="composer-image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; onAddImages(files); }} /><button type="button" disabled={busy || openingThread} onClick={() => imageInputRef.current?.click()} aria-label="이미지 첨부" title="이미지 첨부 또는 붙여넣기"><Icon name="files" />이미지 첨부</button></div>}
        {supportsImages && imageAttachments.length > 0 && <div className="composer-image-attachments">{imageAttachments.map((image) => <div className="composer-image-attachment" key={image.id}><img src={`data:${image.mimeType};base64,${image.data}`} alt="" /><span title={image.name}>{image.name}</span><button type="button" disabled={busy} onClick={() => onRemoveImage(image.id)} aria-label={`${image.name} 첨부 제거`} title="첨부 제거"><Icon name="close" /></button></div>)}</div>}
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            if (!supportsImages || busy) return;
            const files = Array.from(event.clipboardData.items).flatMap((item) => {
              if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
              const file = item.getAsFile();
              return file ? [file] : [];
            });
            if (files.length) { event.preventDefault(); onAddImages(files); }
          }}
          placeholder={busy ? "현재 작업에 추가할 메시지 입력…" : "현재 세션에 메시지 보내기…"}
          rows={2}
          disabled={connectionState !== "connected"}
        />
        <div className="composer-controls"><div className="composer-tools"><button className="model-pill" type="button" onClick={onOpenModelSettings} aria-haspopup="dialog" aria-expanded={modelSettingsDialogOpen} title={`${selectedModel?.description ? `${selectedModel.description} · ` : ""}${displayedEffort ? `사고 수준: ${effortLabel(displayedEffort)}` : `${providerName} 모델 및 세션 설정`}`}><span className="model-dot" /><span className="model-pill-name">{selectedModel?.displayName || currentModel || "모델 설정"}</span>{displayedEffort && <span className="model-pill-effort">{effortLabel(displayedEffort)}</span>}</button></div><div className="composer-actions">{busy && !draft.trim() && <button className="send-button stop-button" disabled={stoppingTurn} onClick={onStopTurn} title={stoppingTurn ? "중지 요청 중" : `${providerName} 작업 중지`} aria-label={stoppingTurn ? "중지 요청 중" : "작업 중지"}><Icon name={stoppingTurn ? "refresh" : "stop"} /></button>}{(!busy || Boolean(draft.trim())) && <button className={`send-button ${busy ? "steer-button" : ""}`} disabled={!draft.trim() || !activeThreadId || (busy && (stoppingTurn || steeringPrompt))} onClick={onSendPrompt} title={busy ? supportsTurnSteering ? "현재 작업에 메시지 전달" : "응답이 끝난 뒤 메시지를 보내세요" : "보내기"} aria-label={busy ? steeringPrompt ? "현재 작업에 메시지 전달 중" : "현재 작업에 메시지 전달" : "메시지 보내기"}>{busy ? <Icon name={steeringPrompt ? "refresh" : "arrow-up"} /> : <Icon name="arrow-up" />}</button>}</div></div>
      </div>
    </div>
  );
}
