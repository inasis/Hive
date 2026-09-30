import type { WorkspaceFileListing, WorkspaceFileText } from "../../domain/workspace.js";

export type WorkspaceFileWrite = { path: string; written: true; bytes: number };

/** Workspace operations required by daemon use cases, independent of local, SSH, or relay transport. */
export interface WorkspaceFilePort {
  list(target: string, cwd: string, path: string): Promise<WorkspaceFileListing>;
  read(target: string, cwd: string, path: string): Promise<WorkspaceFileText>;
  write(target: string, cwd: string, path: string, content: string): Promise<WorkspaceFileWrite>;
}
