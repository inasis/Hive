import { LOCAL_WORKSPACE_TARGET, type WorkspaceFileListing, type WorkspaceFileText } from "../../domain/workspace.js";
import type { WorkspaceFilePort, WorkspaceFileWrite } from "../../application/ports/workspace-files.js";
import { parseWorkspaceFileListing, parseWorkspaceFileText, parseWorkspaceFileWrite } from "./workspace-file-mapper.js";
import { listLocalWorkspaceFiles, readLocalWorkspaceFile, writeLocalWorkspaceFile } from "./local-files.js";
import { requestSshWorkspaceFile, requestSshWorkspaceWrite } from "./ssh-files.js";
import { requestRelayWorkspaceFile } from "./relay-files.js";
import { parseHiveRelayTarget } from "../transport/relay-target.js";

/** Select a target-specific adapter and validate remote data at the port boundary. */
export class RoutedWorkspaceFileAdapter implements WorkspaceFilePort {
  async list(target: string, cwd: string, path: string): Promise<WorkspaceFileListing> {
    const relay = parseHiveRelayTarget(target);
    const result: unknown = target === LOCAL_WORKSPACE_TARGET
      ? await listLocalWorkspaceFiles(cwd, path)
      : relay
        ? await requestRelayWorkspaceFile(relay, "list", cwd, path)
        : await requestSshWorkspaceFile(target, cwd, "list", path);
    return parseWorkspaceFileListing(result);
  }

  async read(target: string, cwd: string, path: string): Promise<WorkspaceFileText> {
    const relay = parseHiveRelayTarget(target);
    const result: unknown = target === LOCAL_WORKSPACE_TARGET
      ? await readLocalWorkspaceFile(cwd, path)
      : relay
        ? await requestRelayWorkspaceFile(relay, "read", cwd, path)
        : await requestSshWorkspaceFile(target, cwd, "read", path);
    return parseWorkspaceFileText(result);
  }

  async write(target: string, cwd: string, path: string, content: string): Promise<WorkspaceFileWrite> {
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
