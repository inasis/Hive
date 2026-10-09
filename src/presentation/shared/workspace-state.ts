import type { WorkspaceFileText } from "./bridge";

export type AppPage = "sessions" | "role-space" | "persona" | "settings";
export type SettingsSection = "connection" | "provider" | "daemons" | "skills" | "mcp" | "theme";
export type WorkspaceTab = "chat" | "terminal" | `file:${string}`;
export type WorkspaceFileTab = { id: string; target: string; cwd: string; file: WorkspaceFileText };
export type WorkspaceFileOpenRequest = { id: number; target: string; cwd: string; path: string };
