import { isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkspaceFilePort } from "../../../application/ports/workspace-files.js";
import type { KiroServerRequest } from "./acp-rpc.js";
import type { KiroRemoteSession } from "./session-types.js";
import { firstString } from "./session-utils.js";

/** Implement ACP file requests through the workspace file port. */
export async function handleKiroWorkspaceRequest(
  workspaceFiles: WorkspaceFilePort,
  session: KiroRemoteSession,
  target: string,
  workspace: string,
  request: KiroServerRequest,
): Promise<void> {
  if (request.method === "fs/read_text_file") {
    const filePath = firstString(request.params.path);
    if (!filePath) throw new Error("Kiro ACP file read requires an absolute path");
    const result = await workspaceFiles.read(target, workspace, kiroWorkspaceRelativePath(workspace, filePath));
    const line = request.params.line;
    const limit = request.params.limit;
    if (line !== undefined && (!Number.isInteger(line) || (line as number) < 1)) throw new Error("Kiro ACP file read line must be a positive integer");
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 0)) throw new Error("Kiro ACP file read limit must be a non-negative integer");
    const startLine = line === undefined ? 1 : line as number;
    const content = line === undefined && limit === undefined
      ? result.content
      : result.content.split("\n").slice(startLine - 1, limit === undefined ? undefined : (startLine - 1) + (limit as number)).join("\n");
    session.connection.respond(request.id, { content });
    return;
  }
  if (request.method === "fs/write_text_file") {
    const filePath = firstString(request.params.path);
    const content = typeof request.params.content === "string" ? request.params.content : undefined;
    if (!filePath || content === undefined) throw new Error("Kiro ACP file write requires an absolute path and text content");
    await workspaceFiles.write(target, workspace, kiroWorkspaceRelativePath(workspace, filePath), content);
    session.connection.respond(request.id, {});
  }
}

function kiroWorkspaceRelativePath(workspace: string, absolutePath: string): string {
  if (!isAbsolute(absolutePath)) throw new Error("Kiro ACP file paths must be absolute");
  const root = resolve(workspace);
  const requested = resolve(absolutePath);
  const relativePath = relative(root, requested);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error("Kiro ACP file paths must stay inside the selected workspace");
  }
  return relativePath;
}
