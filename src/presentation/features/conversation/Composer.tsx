import { Icon } from "../../shared/Icon";
import { effortLabel } from "../../shared/effort-label";
import type { LocalFileAttachment, LocalImageAttachment } from "../../shared/conversation-view";
import type { SlashMenuItem } from "../../shared/slash-menu";
import type { AssistantProvider, RemoteCommand, RemoteModel, RemoteSkill } from "../../shared/bridge";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import { ComposerAttachments } from "./ComposerAttachments.js";
import { ComposerSlashMenu } from "./ComposerSlashMenu.js";
import { useComposerInput } from "./useComposerInput.js";

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
  fileAttachments,
  onAddFiles,
  onRemoveFile,
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
  fileAttachments: LocalFileAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  currentModel: string;
  selectedModel?: RemoteModel;
  displayedEffort: string;
  modelSettingsDialogOpen: boolean;
  onOpenModelSettings: () => void;
}) {
  const { textareaRef, handleKeyDown, handlePaste, chooseSlashMenuItem } = useComposerInput({
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
  });
  const supportsTurnSteering = assistantProviderSupports(provider, "turnSteering");

  return (
    <div className="composer-area">
      {notice && <div className="inline-notice" role="status"><Icon name="info" />{notice}<button className="icon-button" onClick={onClearNotice}><Icon name="close" /></button></div>}
      <div className="composer-wrap">
        {selectedSkill && <div className="selected-skill-chip"><span>{selectedSkill.provider}</span><b>{selectedSkill.name}</b><button type="button" aria-label="선택한 스킬 해제" title="스킬 해제" onClick={onClearSelectedSkill}><Icon name="close" /></button></div>}
        {slashMenuOpen && <ComposerSlashMenu
          items={slashItems}
          activeIndex={slashSkillIndex}
          loading={slashSkillLoading}
          skillWarnings={skillWarnings}
          skills={skills}
          slashCommands={slashCommands}
          onChooseItem={chooseSlashMenuItem}
        />}
        <ComposerAttachments
          provider={provider}
          busy={busy}
          openingThread={openingThread}
          imageAttachments={imageAttachments}
          onAddImages={onAddImages}
          onRemoveImage={onRemoveImage}
          fileAttachments={fileAttachments}
          onAddFiles={onAddFiles}
          onRemoveFile={onRemoveFile}
        />
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={busy ? "현재 작업에 추가할 메시지 입력…" : "현재 세션에 메시지 보내기…"}
          rows={2}
          disabled={connectionState !== "connected"}
        />
        <div className="composer-controls"><div className="composer-tools"><button className="model-pill" type="button" onClick={onOpenModelSettings} aria-haspopup="dialog" aria-expanded={modelSettingsDialogOpen} title={`${selectedModel?.description ? `${selectedModel.description} · ` : ""}${displayedEffort ? `사고 수준: ${effortLabel(displayedEffort)}` : `${providerName} 모델 및 세션 설정`}`}><span className="model-dot" /><span className="model-pill-name">{selectedModel?.displayName || currentModel || "모델 설정"}</span>{displayedEffort && <span className="model-pill-effort">{effortLabel(displayedEffort)}</span>}</button></div><div className="composer-actions">{busy && !draft.trim() && <button className="send-button stop-button" disabled={stoppingTurn} onClick={onStopTurn} title={stoppingTurn ? "중지 요청 중" : `${providerName} 작업 중지`} aria-label={stoppingTurn ? "중지 요청 중" : "작업 중지"}><Icon name={stoppingTurn ? "refresh" : "stop"} /></button>}{(!busy || Boolean(draft.trim())) && <button className={`send-button ${busy ? "steer-button" : ""}`} disabled={!draft.trim() || !activeThreadId || (busy && (stoppingTurn || steeringPrompt))} onClick={onSendPrompt} title={busy ? supportsTurnSteering ? "현재 작업에 메시지 전달" : "응답이 끝난 뒤 메시지를 보내세요" : "보내기"} aria-label={busy ? steeringPrompt ? "현재 작업에 메시지 전달 중" : "현재 작업에 메시지 전달" : "메시지 보내기"}>{busy ? <Icon name={steeringPrompt ? "refresh" : "arrow-up"} /> : <Icon name="arrow-up" />}</button>}</div></div>
      </div>
    </div>
  );
}
