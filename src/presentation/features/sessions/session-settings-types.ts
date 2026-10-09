export type SessionSettingsChange =
  | { model: string; effort?: string; permissionProfile?: never; modeId?: never }
  | { model?: never; effort: string; permissionProfile?: never; modeId?: never }
  | { model?: never; effort?: never; permissionProfile: string; modeId?: never }
  | { model?: never; effort?: never; permissionProfile?: never; modeId: string };
