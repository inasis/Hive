import type { AssistantPermissionPreset } from "../../../domain/assistant.js";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const KIRO_PERMISSION_PRESET_OPTIONS: AssistantPermissionPreset[] = [
  { id: "read-workspace", label: "작업 공간 읽기", description: "현재 작업 공간의 파일을 읽도록 허용합니다." },
  { id: "edit-workspace", label: "작업 공간 편집", description: "현재 작업 공간 파일 편집을 허용합니다." },
  { id: "read-all", label: "전체 파일 읽기", description: "작업 공간 밖을 포함해 파일 읽기를 허용합니다." },
  { id: "read-only-shell", label: "읽기 전용 셸", description: "읽기 전용으로 분류된 셸 명령을 허용합니다." },
  { id: "dev-shell", label: "개발 셸", description: "개발 작업에 필요한 셸 명령을 허용합니다." },
  { id: "allow-all", label: "모든 도구 허용", description: "Kiro 도구 실행을 자동 허용합니다." },
];
const KIRO_PERMISSION_PRESET_IDS = new Set(KIRO_PERMISSION_PRESET_OPTIONS.map((preset) => preset.id));
const KIRO_PERMISSION_PROFILE_OPTIONS: AssistantPermissionPreset[] = [
  { id: "allow-all", label: "모두 허용", description: "Kiro가 허용할 수 있는 도구를 자동 허용합니다. Kiro 및 관리자 제한은 유지됩니다." },
  { id: "read-only", label: "읽기 전용", description: "작업 공간 읽기와 읽기 전용 셸 명령을 자동 허용합니다." },
  { id: "user-choice", label: "사용자 선택", description: "Kiro 기본 정책에 따라 도구 권한을 요청합니다." },
];
const KIRO_PERMISSION_PROFILE_PRESETS: Record<string, string[]> = {
  "allow-all": ["allow-all"],
  "read-only": ["read-workspace", "read-only-shell"],
  "user-choice": [],
};

export function isValidKiroSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

export function isKiroPermissionPreset(value: unknown): value is string {
  return typeof value === "string" && KIRO_PERMISSION_PRESET_IDS.has(value);
}

export function validateKiroPermissionPresets(presets: string[]): string[] {
  const invalid = presets.find((preset) => !KIRO_PERMISSION_PRESET_IDS.has(preset));
  if (invalid) throw new Error(`Unknown Kiro permission preset: ${invalid}`);
  return [...new Set(presets)];
}

export function listKiroPermissionPresetOptions(): AssistantPermissionPreset[] {
  return KIRO_PERMISSION_PROFILE_OPTIONS.map((preset) => ({ ...preset }));
}

export function isKiroPermissionProfile(value: string): boolean {
  return Object.hasOwn(KIRO_PERMISSION_PROFILE_PRESETS, value);
}

export function kiroPermissionPresetsForProfile(profile: string): string[] {
  const presets = KIRO_PERMISSION_PROFILE_PRESETS[profile];
  if (!presets) throw new Error(`Unknown Kiro permission profile: ${profile}`);
  return [...presets];
}

export function kiroPermissionProfileForPresets(presets: string[]): string {
  const validated = validateKiroPermissionPresets(presets);
  if (!validated.length) return "user-choice";
  if (validated.includes("allow-all")) return "allow-all";
  const profilePresets = KIRO_PERMISSION_PROFILE_PRESETS["read-only"]!;
  if (validated.length === profilePresets.length && profilePresets.every((preset) => validated.includes(preset))) {
    return "read-only";
  }
  return validated.join(",");
}
