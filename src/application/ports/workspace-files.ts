import type { WorkspaceFileListingDto, WorkspaceFileTextDto, WorkspaceFileWriteDto } from "../dto/workspace.js";

/** Workspace operations required by daemon use cases, independent of local or SSH transport. */
export interface WorkspaceFilePort {
  list(target: string, cwd: string, path: string): Promise<WorkspaceFileListingDto>;
  read(target: string, cwd: string, path: string): Promise<WorkspaceFileTextDto>;
  write(target: string, cwd: string, path: string, content: string): Promise<WorkspaceFileWriteDto>;
}
