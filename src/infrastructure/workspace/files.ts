import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";
import type { WorkspaceFilePort } from "../../application/ports/workspace-files.js";
import type { WorkspaceFileListingDto, WorkspaceFileTextDto, WorkspaceFileWriteDto } from "../../application/dto/workspace.js";
import { parseWorkspaceFileListing, parseWorkspaceFileText, parseWorkspaceFileWrite } from "./workspace-file-mapper.js";
import { listLocalWorkspaceFiles, readLocalWorkspaceFile, writeLocalWorkspaceFile } from "./local-files.js";
import { requestSshWorkspaceFile, requestSshWorkspaceWrite } from "./ssh-files.js";

/** Select a target-specific adapter and validate remote data at the port boundary. */
export class RoutedWorkspaceFileAdapter implements WorkspaceFilePort {
  async list(target: string, cwd: string, path: string): Promise<WorkspaceFileListingDto> {
    const result: unknown = target === LOCAL_WORKSPACE_TARGET
      ? await listLocalWorkspaceFiles(cwd, path)
      : await requestSshWorkspaceFile(target, cwd, "list", path);
    return parseWorkspaceFileListing(result);
  }

  async read(target: string, cwd: string, path: string): Promise<WorkspaceFileTextDto> {
    const result: unknown = target === LOCAL_WORKSPACE_TARGET
      ? await readLocalWorkspaceFile(cwd, path)
      : await requestSshWorkspaceFile(target, cwd, "read", path);
    return parseWorkspaceFileText(result);
  }

  async write(target: string, cwd: string, path: string, content: string): Promise<WorkspaceFileWriteDto> {
    const result: unknown = target === LOCAL_WORKSPACE_TARGET
      ? await writeLocalWorkspaceFile(cwd, path, content)
      : await requestSshWorkspaceWrite(target, cwd, path, content);
    const writeResult = parseWorkspaceFileWrite(result);
    if (writeResult.bytes !== Buffer.byteLength(content, "utf8")) {
      throw new Error("Remote workspace returned an invalid file write result");
    }
    return writeResult;
  }
}
