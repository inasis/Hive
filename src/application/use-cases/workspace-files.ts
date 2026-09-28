import type { WorkspaceFileListing, WorkspaceFileText } from "../../domain/workspace.js";
import type { WorkspaceFilePort } from "../ports/workspace-files.js";

/** Workspace file actions shared by desktop, Android, and future CLI interfaces. */
export class WorkspaceFileUseCases {
  constructor(private readonly files: WorkspaceFilePort) {}

  list(target: string, cwd: string, path: string): Promise<WorkspaceFileListing> {
    return this.files.list(target, cwd, path);
  }

  read(target: string, cwd: string, path: string): Promise<WorkspaceFileText> {
    return this.files.read(target, cwd, path);
  }
}
