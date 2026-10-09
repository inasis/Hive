import type { WorkspaceFileListingDto, WorkspaceFileTextDto } from "../dto/workspace.js";
import type { WorkspaceFilePort } from "../ports/workspace-files.js";

/** Workspace file actions shared by desktop, Android, and future CLI interfaces. */
export class WorkspaceFileUseCases {
  constructor(private readonly files: WorkspaceFilePort) {}

  list(target: string, cwd: string, path: string): Promise<WorkspaceFileListingDto> {
    return this.files.list(target, cwd, path);
  }

  read(target: string, cwd: string, path: string): Promise<WorkspaceFileTextDto> {
    return this.files.read(target, cwd, path);
  }
}
