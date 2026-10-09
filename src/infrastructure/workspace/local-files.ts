import { constants as fsConstants } from "node:fs";
import { open, realpath, readdir, stat, lstat, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  WorkspaceFileItemDto,
  WorkspaceFileListingDto,
  WorkspaceFileTextDto,
  WorkspaceFileWriteDto,
} from "../../application/dto/workspace.js";
import { MAX_DIRECTORY_ENTRIES, MAX_TEXT_FILE_BYTES, MAX_TEXT_WRITE_BYTES } from "./file-limits.js";
import { isAbsoluteWorkspacePath } from "./workspace-path.js";

/** List one directory below a workspace, omitting symlinks that leave its root. */
export async function listLocalWorkspaceFiles(rootPath: string, relativePath: string): Promise<WorkspaceFileListingDto> {
  const { root, target } = await resolveWorkspaceLocation(rootPath, relativePath);
  const entries = await readdir(target, { withFileTypes: true });
  const items: WorkspaceFileItemDto[] = [];
  for (const entry of entries.slice(0, MAX_DIRECTORY_ENTRIES)) {
    const absolutePath = resolve(target, entry.name);
    let resolvedPath: string;
    try {
      resolvedPath = await realpath(absolutePath);
    } catch {
      continue;
    }
    if (!isWithin(root, resolvedPath)) continue;
    const metadata = await stat(resolvedPath).catch(() => undefined);
    if (!metadata || (!metadata.isDirectory() && !metadata.isFile())) continue;
    const itemPath = relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    const childPath = itemPath ? `${itemPath}/${entry.name}` : entry.name;
    items.push({
      name: entry.name,
      path: childPath,
      kind: metadata.isDirectory() ? "directory" : "file",
      size: metadata.isFile() ? metadata.size : null,
    });
  }
  items.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
  return { path: relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""), items };
}

/** Read a bounded UTF-8 text file inside a workspace. */
export async function readLocalWorkspaceFile(rootPath: string, relativePath: string): Promise<WorkspaceFileTextDto> {
  if (!relativePath.trim()) throw new Error("Choose a file to open");
  const { target } = await resolveWorkspaceLocation(rootPath, relativePath);
  const metadata = await stat(target);
  if (!metadata.isFile()) throw new Error("Only regular text files can be opened");
  if (metadata.size > MAX_TEXT_FILE_BYTES) throw new Error("File preview is limited to 1 MiB");
  const contents = await readFile(target);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    throw new Error("This file is not valid UTF-8 text");
  }
  return { path: relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""), content, bytes: contents.length };
}

/** Write a bounded UTF-8 text file inside an existing workspace directory. */
export async function writeLocalWorkspaceFile(rootPath: string, relativePath: string, content: string): Promise<WorkspaceFileWriteDto> {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_TEXT_WRITE_BYTES) throw new Error("Workspace text writes are limited to 5 MiB");
  const { target } = await resolveWorkspaceWriteLocation(rootPath, relativePath);
  const existing = await lstat(target).catch(() => undefined);
  if (existing?.isSymbolicLink()) throw new Error("Workspace file writes cannot follow symbolic links");
  if (existing && !existing.isFile()) throw new Error("Only regular text files can be written");
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const file = await open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | noFollow, 0o666);
  try {
    await file.writeFile(content, "utf8");
  } finally {
    await file.close();
  }
  return { path: relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""), written: true, bytes };
}

async function resolveWorkspaceLocation(rootPath: string, relativePath: string): Promise<{ root: string; target: string }> {
  if (!isAbsoluteWorkspacePath(rootPath.trim())) throw new Error("Workspace path must be absolute");
  const root = await realpath(rootPath);
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const target = await realpath(resolve(root, normalized));
  if (!isWithin(root, target)) throw new Error("Workspace path must stay inside the selected workspace");
  return { root, target };
}

async function resolveWorkspaceWriteLocation(rootPath: string, relativePath: string): Promise<{ root: string; target: string }> {
  if (!isAbsoluteWorkspacePath(rootPath.trim())) throw new Error("Workspace path must be absolute");
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized.trim() || normalized.split("/").some((part) => part === "..")) throw new Error("Workspace path must stay inside the selected workspace");
  const root = await realpath(rootPath);
  const candidate = resolve(root, normalized);
  if (!isWithin(root, candidate) || candidate === root) throw new Error("Workspace path must stay inside the selected workspace");
  const parent = await realpath(dirname(candidate));
  if (!isWithin(root, parent)) throw new Error("Workspace path must stay inside the selected workspace");
  return { root, target: resolve(parent, basename(candidate)) };
}

function isWithin(root: string, target: string): boolean {
  const remainder = relative(root, target);
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}
