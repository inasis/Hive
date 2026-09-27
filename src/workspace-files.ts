import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { open, realpath, readdir, stat, lstat, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";
import { secureRelayStream } from "./e2e-stream.js";
import { assertSshTarget } from "./codex-rpc.js";
import { connectHiveRelay, type HiveRelayTarget } from "./tcp-relay.js";

export type WorkspaceFileItem = {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number | null;
};

export type WorkspaceFileListing = { path: string; items: WorkspaceFileItem[] };
export type WorkspaceFileText = { path: string; content: string; bytes: number };
export type WorkspaceFileWrite = { path: string; written: true; bytes: number };
export type WorkspaceFileOperation =
  | { operation: "list"; target: string; cwd: string; path: string }
  | { operation: "read"; target: string; cwd: string; path: string };
export type WorkspaceFileResult = WorkspaceFileListing | WorkspaceFileText;

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_TEXT_WRITE_BYTES = 5 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 2_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** List one directory below a workspace, omitting symlinks that leave its root. */
export async function listLocalWorkspaceFiles(rootPath: string, relativePath: string): Promise<WorkspaceFileListing> {
  const { root, target } = await resolveWorkspaceLocation(rootPath, relativePath);
  const entries = await readdir(target, { withFileTypes: true });
  const items: WorkspaceFileItem[] = [];
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
export async function readLocalWorkspaceFile(rootPath: string, relativePath: string): Promise<WorkspaceFileText> {
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
export async function writeLocalWorkspaceFile(rootPath: string, relativePath: string, content: string): Promise<WorkspaceFileWrite> {
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

/** Read-only workspace access over SSH. File data is returned as JSON by remote Python. */
export async function requestSshWorkspaceFile(
  target: string,
  cwd: string,
  operation: "list" | "read",
  path: string,
): Promise<WorkspaceFileResult> {
  return await requestSshWorkspaceOperation(target, cwd, operation, path) as WorkspaceFileResult;
}

/** Write a bounded UTF-8 text file inside an existing remote workspace directory. */
export async function requestSshWorkspaceWrite(
  target: string,
  cwd: string,
  path: string,
  content: string,
): Promise<WorkspaceFileWrite> {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_TEXT_WRITE_BYTES) throw new Error("Workspace text writes are limited to 5 MiB");
  return await requestSshWorkspaceOperation(target, cwd, "write", path, content) as WorkspaceFileWrite;
}

async function requestSshWorkspaceOperation(
  target: string,
  cwd: string,
  operation: "list" | "read" | "write",
  path: string,
  content?: string,
): Promise<unknown> {
  assertSshTarget(target);
  if (!isRemoteAbsolute(cwd.trim())) throw new Error("Workspace path must be absolute");
  const payload = Buffer.from(JSON.stringify({ root: cwd, operation, path, ...(content === undefined ? {} : { content }) }), "utf8");
  const command = `python3 -c ${shellQuote(SSH_WORKSPACE_SCRIPT)}`;
  return await new Promise<unknown>((resolveResult, reject) => {
    const child = spawn("ssh", ["-T", target, command], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end(payload);
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("SSH workspace request timed out"));
    }, 30_000);
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolveResult(value!);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_RESPONSE_BYTES) {
        child.kill("SIGTERM");
        finish(new Error("Remote workspace response exceeded the size limit"));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.concat(errors).length < 16_384) errors.push(chunk);
    });
    child.once("error", (error) => finish(new Error(`Could not start ssh: ${error.message}`)));
    child.once("close", (code) => {
      if (settled) return;
      const text = Buffer.concat(output).toString("utf8").trim();
      let response: unknown;
      try {
        response = JSON.parse(text);
      } catch {
        const stderr = Buffer.concat(errors).toString("utf8").trim();
        finish(new Error(code === 0 ? "Remote workspace returned invalid data" : (stderr || `SSH exited with status ${code}`)));
        return;
      }
      if (typeof response !== "object" || response === null || Array.isArray(response)) {
        finish(new Error("Remote workspace returned invalid data"));
        return;
      }
      const record = response as Record<string, unknown>;
      if (typeof record.error === "string") {
        finish(new Error(record.error));
        return;
      }
      if (code !== 0) {
        finish(new Error(Buffer.concat(errors).toString("utf8").trim() || `SSH exited with status ${code}`));
        return;
      }
      finish(undefined, record as unknown as WorkspaceFileResult);
    });
  });
}

/** Request a directory listing or a file preview through the daemon's encrypted files channel. */
export async function requestRelayWorkspaceFile(
  target: HiveRelayTarget,
  operation: "list" | "read",
  cwd: string,
  path: string,
): Promise<WorkspaceFileResult> {
  const socket = await connectHiveRelay(target, "client", undefined, "files");
  const stream = await secureRelayStream(socket, target, "client", "files");
  try {
    const response = await exchangeJsonLine(stream, { operation, cwd, path });
    if (typeof response !== "object" || response === null || Array.isArray(response)) {
      throw new Error("Relay daemon returned invalid workspace data");
    }
    const record = response as Record<string, unknown>;
    if (typeof record.error === "string") throw new Error(record.error);
    return record as WorkspaceFileResult;
  } finally {
    stream.destroy();
  }
}

async function resolveWorkspaceLocation(rootPath: string, relativePath: string): Promise<{ root: string; target: string }> {
  if (!isRemoteAbsolute(rootPath.trim())) throw new Error("Workspace path must be absolute");
  const root = await realpath(rootPath);
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const target = await realpath(resolve(root, normalized));
  if (!isWithin(root, target)) throw new Error("Workspace path must stay inside the selected workspace");
  return { root, target };
}

async function resolveWorkspaceWriteLocation(rootPath: string, relativePath: string): Promise<{ root: string; target: string }> {
  if (!isRemoteAbsolute(rootPath.trim())) throw new Error("Workspace path must be absolute");
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

async function exchangeJsonLine(stream: Duplex, request: Record<string, string>): Promise<unknown> {
  return await new Promise((resolveResponse, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error("Timed out waiting for the relay daemon")), 30_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
      stream.off("close", onClose);
    };
    const finish = (error?: Error, value?: unknown): void => {
      cleanup();
      if (error) reject(error);
      else resolveResponse(value);
    };
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_RESPONSE_BYTES) {
        finish(new Error("Relay workspace response exceeded the size limit"));
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      try {
        finish(undefined, JSON.parse(buffer.subarray(0, newline).toString("utf8")) as unknown);
      } catch {
        finish(new Error("Relay daemon returned invalid workspace data"));
      }
    };
    const onError = (error: Error): void => finish(error);
    const onEnd = (): void => finish(new Error("Relay daemon closed before replying"));
    const onClose = (): void => finish(new Error("Relay daemon closed before replying"));
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
    stream.once("close", onClose);
    stream.write(JSON.stringify(request) + "\n");
  });
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function isRemoteAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

const SSH_WORKSPACE_SCRIPT = [
  "import os,sys,json,base64,stat",
  "try:",
  " c=json.loads(base64.b64decode(sys.stdin.buffer.read())); root=os.path.realpath(c['root']); rel=c.get('path','').replace('\\\\','/').lstrip('/'); target=os.path.realpath(os.path.join(root,rel))",
  " if os.path.commonpath([root,target]) != root: raise ValueError('Workspace path must stay inside the selected workspace')",
  " if c['operation']=='list':",
  "  items=[]",
  "  for name in sorted(os.listdir(target),key=lambda n:(not os.path.isdir(os.path.join(target,n)),n.casefold()))[:2000]:",
  "   p=os.path.realpath(os.path.join(target,name))",
  "   if os.path.commonpath([root,p]) != root: continue",
  "   s=os.stat(p)",
  "   if stat.S_ISDIR(s.st_mode): items.append({'name':name,'path':('/'.join(x for x in [rel,name] if x)),'kind':'directory','size':None})",
  "   elif stat.S_ISREG(s.st_mode): items.append({'name':name,'path':('/'.join(x for x in [rel,name] if x)),'kind':'file','size':s.st_size})",
  "  print(json.dumps({'path':rel,'items':items},ensure_ascii=True))",
  " elif c['operation']=='read':",
  "  s=os.stat(target)",
  "  if not stat.S_ISREG(s.st_mode): raise ValueError('Only regular text files can be opened')",
  "  if s.st_size>1048576: raise ValueError('File preview is limited to 1 MiB')",
  "  data=open(target,'rb').read(); content=data.decode('utf-8')",
  "  print(json.dumps({'path':rel,'content':content,'bytes':len(data)},ensure_ascii=True))",
  " elif c['operation']=='write':",
  "  if not rel: raise ValueError('Choose a file to write')",
  "  content=c.get('content')",
  "  if not isinstance(content,str): raise ValueError('Workspace file content must be text')",
  "  data=content.encode('utf-8')",
  "  if len(data)>5242880: raise ValueError('Workspace text writes are limited to 5 MiB')",
  "  parent=os.path.realpath(os.path.dirname(os.path.join(root,rel)))",
  "  if os.path.commonpath([root,parent]) != root: raise ValueError('Workspace path must stay inside the selected workspace')",
  "  target=os.path.join(parent,os.path.basename(rel))",
  "  if os.path.islink(target): raise ValueError('Workspace file writes cannot follow symbolic links')",
  "  if os.path.exists(target) and not stat.S_ISREG(os.stat(target).st_mode): raise ValueError('Only regular text files can be written')",
  "  with open(target,'w',encoding='utf-8',newline='') as f: f.write(content)",
  "  print(json.dumps({'path':rel,'written':True,'bytes':len(data)},ensure_ascii=True))",
  " else: raise ValueError('Unknown workspace operation')",
  "except Exception as e: print(json.dumps({'error':str(e)},ensure_ascii=True)); sys.exit(1)",
].join("\n");
