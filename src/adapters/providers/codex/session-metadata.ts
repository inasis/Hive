import type { AssistantPermissionPreset } from "../../../domain/assistant.js";

const CODEX_PERMISSION_PRESETS: AssistantPermissionPreset[] = [
  { id: ":read-only", label: "읽기 전용", description: "파일을 읽을 수 있으며 수정이나 네트워크 접근에는 승인이 필요합니다." },
  { id: ":workspace", label: "기본", description: "현재 작업 공간에서 파일을 수정할 수 있습니다." },
  { id: ":danger-full-access", label: "전체 접근", description: "작업 공간 외부 파일과 네트워크에도 승인 없이 접근합니다." },
];

export function isCodexPermissionPreset(value: string): boolean {
  return CODEX_PERMISSION_PRESETS.some((preset) => preset.id === value);
}

export function listCodexPermissionPresetOptions(): AssistantPermissionPreset[] {
  return CODEX_PERMISSION_PRESETS.map((preset) => ({ ...preset }));
}
