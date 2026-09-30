/** Stable identifier for workspaces handled by the current Hive process. */
export const LOCAL_WORKSPACE_TARGET = "hive-local://";

export type WorkspaceFileItem = {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number | null;
};

export type WorkspaceFileListing = { path: string; items: WorkspaceFileItem[] };
export type WorkspaceFileText = { path: string; content: string; bytes: number };
