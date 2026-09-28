import type { WorkspaceFileText } from "../../../shared/bridge";

export type AppPage = "sessions" | "skills" | "settings";
export type SettingsSection = "connection" | "theme";
export type WorkspaceTab = "chat" | "terminal" | `file:${string}`;
export type WorkspaceFileTab = { id: string; target: string; cwd: string; file: WorkspaceFileText };
export type WorkspaceFileOpenRequest = { id: number; target: string; cwd: string; path: string };
