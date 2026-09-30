import { spawn } from "node:child_process";
import { MAX_TEXT_WRITE_BYTES, MAX_WORKSPACE_RESPONSE_BYTES } from "./file-limits.js";
import { assertSshTarget } from "../transport/workspace-target.js";
import { isAbsoluteWorkspacePath } from "./workspace-path.js";

/** Read-only workspace access over SSH. File data is returned as JSON by remote Python. */
export async function requestSshWorkspaceFile(
  target: string,
  cwd: string,
  operation: "list" | "read",
  path: string,
): Promise<unknown> {
  return requestSshWorkspaceOperation(target, cwd, operation, path);
}

/** Write a bounded UTF-8 text file inside an existing remote workspace directory. */
export async function requestSshWorkspaceWrite(
  target: string,
  cwd: string,
  path: string,
  content: string,
): Promise<unknown> {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_TEXT_WRITE_BYTES) throw new Error("Workspace text writes are limited to 5 MiB");
  return requestSshWorkspaceOperation(target, cwd, "write", path, content);
}

async function requestSshWorkspaceOperation(
  target: string,
  cwd: string,
  operation: "list" | "read" | "write",
  path: string,
  content?: string,
): Promise<unknown> {
  assertSshTarget(target);
  if (!isAbsoluteWorkspacePath(cwd.trim())) throw new Error("Workspace path must be absolute");
  const payload = Buffer.from(JSON.stringify({ root: cwd, operation, path, ...(content === undefined ? {} : { content }) }), "utf8").toString("base64");
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
      if (outputBytes > MAX_WORKSPACE_RESPONSE_BYTES) {
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
      finish(undefined, record);
    });
  });
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
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
