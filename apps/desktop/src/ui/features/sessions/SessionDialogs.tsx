import type { FormEvent, MouseEvent } from "react";
import type { AssistantProvider, RemoteMode, RemoteModel, RemotePermissionPreset, RemoteThread } from "../../../shared/bridge";
import { Icon } from "../../shared/Icon";
import { effortLabel } from "../../shared/effort-label";
import { assistantProviderSupports } from "../../../../../../src/domain/provider-catalog.js";
import { providerDisplayName } from "../../shared/provider-display-name";
import type { ApprovalUiRequest } from "../../shared/bridge-event-adapter";
import type { SessionSettingsChange } from "./session-settings-types";

type RenameDraft = { threadId: string; provider: AssistantProvider; title: string };
type ApprovalAnswer = "decline" | "acceptForSession" | "accept";

export function SessionDialogs({ model, modelActions, rename, renameActions, approval, onAnswerApproval, deletion, deleteActions }: {
  model: {
    open: boolean;
    threadId: string;
    provider: AssistantProvider;
    providerName: string;
    currentModel: string;
    models: RemoteModel[];
    permissionPresets: RemotePermissionPreset[];
    selectedModel?: RemoteModel;
    warning: string;
    updating: boolean;
    busy: boolean;
    displayedEffort: string;
    reasoningOptions: NonNullable<RemoteModel["supportedReasoningEfforts"]>;
    modes: RemoteMode[];
    currentModeId: string | null;
    permissionProfile: string | null;
  };
  modelActions: {
    close: () => void;
    update: (change: SessionSettingsChange) => void;
    changeModel: (modelId: string) => void;
  };
  rename: { draft: RenameDraft | null; name: string; error: string; saving: boolean; providerName: string };
  renameActions: {
    close: () => void;
    changeName: (name: string) => void;
    save: () => void;
  };
  approval: ApprovalUiRequest | null;
  onAnswerApproval: (answer: ApprovalAnswer) => void;
  deletion: { thread: RemoteThread | null; error: string; deleting: boolean; running: boolean };
  deleteActions: { close: () => void; confirm: () => void };
}) {
  const supportsReasoningEffort = assistantProviderSupports(model.provider, "reasoningEffort");
  const supportsSessionModes = assistantProviderSupports(model.provider, "sessionModes");
  const createsWithPermissionProfiles = assistantProviderSupports(model.provider, "permissionProfileCreation");
  const canUpdatePermissionProfiles = assistantProviderSupports(model.provider, "permissionProfileUpdates");
  const handleRenameSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    renameActions.save();
  };
  const closeModelOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !model.updating) modelActions.close();
  };
  const closeRenameOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !rename.saving) renameActions.close();
  };
  const closeDeleteOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !deletion.deleting) deleteActions.close();
  };

  return <>
    {model.open && model.threadId && <div className="dialog-backdrop model-settings-backdrop" onMouseDown={closeModelOnBackdrop}>
      <section className="connect-dialog model-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
        <div className="model-settings-heading"><div><span className="eyebrow">SESSION SETTINGS</span><h2 id="model-settings-title">모델 및 세션 설정</h2></div><button className="icon-button" type="button" aria-label="설정 닫기" title="설정 닫기" onClick={modelActions.close} disabled={model.updating}><Icon name="close" /></button></div>
        <div className="model-controls">
          <label className="model-control"><span>모델</span><select aria-label={`${model.providerName} 모델`} value={model.currentModel} disabled={model.updating || model.busy || model.models.length === 0} onChange={(event) => modelActions.changeModel(event.target.value)} title={model.selectedModel?.description || model.warning || `${model.providerName} 모델 선택`}>
            {model.currentModel && !model.models.some((candidate) => candidate.model === model.currentModel && !candidate.hidden) && <option value={model.currentModel}>{model.selectedModel?.displayName ?? model.currentModel}{model.selectedModel?.hidden ? " · 숨김" : " · 현재"}</option>}
            {model.models.filter((candidate) => !candidate.hidden).map((candidate) => <option key={candidate.model} value={candidate.model}>{candidate.displayName}{candidate.isDefault ? " · 기본" : ""}</option>)}
            {!model.models.length && <option value="">{model.warning ? "모델 목록을 불러오지 못함" : "모델 없음"}</option>}
          </select></label>
          {supportsReasoningEffort && <label className="model-control thinking-control"><span>Thinking</span><select aria-label="Thinking 수준" value={model.displayedEffort} disabled={model.updating || model.busy || model.reasoningOptions.length === 0} onChange={(event) => modelActions.update({ effort: event.target.value })} title="다음 턴부터 적용됩니다">
            {model.reasoningOptions.map((option) => <option key={option.reasoningEffort} value={option.reasoningEffort}>{effortLabel(option.reasoningEffort)}</option>)}
            {!model.reasoningOptions.length && <option value="">지원 옵션 없음</option>}
          </select></label>}
          {supportsSessionModes && model.modes.length > 0 && <label className="model-control"><span>에이전트</span><select aria-label={`${model.providerName} 세션 모드`} value={model.currentModeId ?? ""} disabled={model.updating || model.busy} onChange={(event) => modelActions.update({ modeId: event.target.value })} title={`${model.providerName} 세션 모드`}>
            {model.modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
          </select></label>}
          {createsWithPermissionProfiles && !canUpdatePermissionProfiles && <p className="dialog-help">시작 권한: {model.permissionProfile ? model.permissionProfile.split(",").map((id) => model.permissionPresets.find((preset) => preset.id === id)?.label ?? id).join(" · ") : `${model.providerName} 기본 승인 흐름`}. 권한 프리셋은 새 세션을 만들 때 설정합니다.</p>}
          {canUpdatePermissionProfiles && <label className="model-control permission-control"><span>권한</span><select aria-label={`${model.providerName} 권한`} value={model.permissionProfile ?? ""} disabled={model.updating || model.busy} onChange={(event) => {
            const preset = model.permissionPresets.find((candidate) => candidate.id === event.target.value);
            if (preset) modelActions.update({ permissionProfile: preset.id });
          }} title={model.permissionPresets.find((preset) => preset.id === model.permissionProfile)?.description ?? `${model.providerName} 세션의 권한`}>
            {!model.permissionProfile && <option value="" disabled>현재 권한</option>}
            {model.permissionProfile && !model.permissionPresets.some((preset) => preset.id === model.permissionProfile) && <option value={model.permissionProfile}>{`현재 · ${model.permissionProfile}`}</option>}
            {model.permissionPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select></label>}
        </div>
        {model.warning && <p className="dialog-help" role="status">{model.warning}</p>}
      </section>
    </div>}

    {rename.draft && <div className="dialog-backdrop" onMouseDown={closeRenameOnBackdrop}>
      <form className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-session-dialog-title" onSubmit={handleRenameSubmit}>
        <div className="dialog-mark"><Icon name="edit" /></div>
        <h2 id="rename-session-dialog-title">세션 이름 수정</h2>
        <p>{rename.providerName} 세션 목록에 표시할 이름을 입력하세요.</p>
        <label htmlFor="rename-session-name">세션 이름</label>
        <input id="rename-session-name" value={rename.name} onChange={(event) => renameActions.changeName(event.target.value)} autoFocus maxLength={120} disabled={rename.saving} />
        {rename.error && <div className="connection-error">{rename.error}</div>}
        <div className="dialog-actions">
          <button type="button" className="dialog-secondary" onClick={renameActions.close} disabled={rename.saving}>취소</button>
          <button type="submit" className="dialog-primary" disabled={!rename.name.trim() || rename.saving}>{rename.saving ? "저장 중…" : "이름 저장"}</button>
        </div>
      </form>
    </div>}

    {approval && <div className="dialog-backdrop"><div className="approval-dialog"><div className="approval-mark"><Icon name="info" /></div><h2>{providerDisplayName(approval.provider)} 권한 요청</h2><p>{approval.kind === "command" || approval.kind === "permission" ? "원격 컴퓨터에서 도구를 실행하려 합니다." : approval.kind === "file" ? "원격 세션의 파일 변경을 적용하려 합니다." : "원격 세션에서 작업 권한을 요청했습니다."}</p><ApprovalDetails approval={approval} /><div className="dialog-actions"><button className="dialog-secondary" onClick={() => onAnswerApproval("decline")}>거절</button><button className="dialog-secondary" onClick={() => onAnswerApproval("acceptForSession")}>세션 동안 허용</button><button className="dialog-primary" onClick={() => onAnswerApproval("accept")}>이번만 허용</button></div></div></div>}

    {deletion.thread && <div className="dialog-backdrop" onMouseDown={closeDeleteOnBackdrop}>
      <div className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-session-dialog-title">
        <div className="dialog-mark"><Icon name="trash" /></div>
        <h2 id="delete-session-dialog-title">세션 삭제</h2>
        <p>“{deletion.thread.title}” 세션과 대화 기록을 영구 삭제할까요? 삭제한 기록은 복구할 수 없습니다.</p>
        {deletion.running && <div className="connection-error" role="status">작업 중인 세션은 먼저 작업을 중지한 뒤 삭제할 수 있습니다.</div>}
        {deletion.error && <div className="connection-error" role="alert">{deletion.error}</div>}
        <div className="dialog-actions">
          <button type="button" className="dialog-secondary" onClick={deleteActions.close} disabled={deletion.deleting}>취소</button>
          <button type="button" className="dialog-danger" onClick={deleteActions.confirm} disabled={deletion.deleting || deletion.running}>
            {deletion.deleting ? "삭제 중…" : "영구 삭제"}
          </button>
        </div>
      </div>
    </div>}
  </>;
}

function ApprovalDetails({ approval }: { approval: ApprovalUiRequest }) {
  return <div className="approval-details">{approval.reason && <p>{approval.reason}</p>}{approval.command && <pre>{approval.command}</pre>}{approval.cwd && <small>작업 경로: {approval.cwd}</small>}</div>;
}
