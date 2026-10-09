import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { MermaidMarkdownPre } from "../../shared/MermaidMarkdown";
import { TranscriptCopyButton } from "./TranscriptCopyButton";

export function TranscriptMarkdown({ text, cwd, onOpenFile }: { text: string; cwd: string; onOpenFile?: (path: string) => void }) {
  const components = useMemo<Components>(() => ({
    a: ({ href, title, children }) => {
      const filePath = href ? resolveMarkdownWorkspacePath(href, cwd) : null;
      if (filePath && onOpenFile) {
        return <a href={href} title={`파일 열기: ${filePath}`} onClick={(event) => { event.preventDefault(); onOpenFile(filePath); }}>{children}</a>;
      }
      const opensNewTab = Boolean(href && /^https?:/i.test(href));
      return <a href={href} title={title} target={opensNewTab ? "_blank" : undefined} rel={opensNewTab ? "noopener noreferrer" : undefined}>{children}</a>;
    },
    pre: ({ children }) => {
      const code = markdownNodeText(Children.toArray(children));
      return <div className="markdown-code-block"><MermaidMarkdownPre>{children}</MermaidMarkdownPre><div className="markdown-code-actions"><TranscriptCopyButton text={code} label="코드" /></div></div>;
    },
    table: ({ children }) => <div className="markdown-table-wrap"><table>{children}</table></div>,
  }), [cwd, onOpenFile]);
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>{text}</ReactMarkdown>;
}

function markdownNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(markdownNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return markdownNodeText(node.props.children);
  return "";
}

function resolveMarkdownWorkspacePath(href: string, cwd: string): string | null {
  if (!href || !cwd || href.startsWith("#")) return null;
  let destination = href;
  if (/^file:/i.test(destination)) {
    try {
      const url = new URL(destination);
      if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) return null;
      destination = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(destination)) destination = destination.slice(1);
    } catch {
      return null;
    }
  } else {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(destination) && !/^[A-Za-z]:[\\/]/.test(destination)) return null;
    destination = destination.split(/[?#]/, 1)[0] ?? "";
    try { destination = decodeURIComponent(destination); } catch { /* Keep valid literal path characters. */ }
  }
  destination = destination.replace(/:\d+(?::\d+)?$/, "").replaceAll("\\", "/");
  const normalizedRoot = normalizeMarkdownPath(cwd.replaceAll("\\", "/"));
  if (!normalizedRoot || (!normalizedRoot.startsWith("/") && !/^[A-Za-z]:\//.test(normalizedRoot))) return null;
  const isAbsolute = destination.startsWith("/") || /^[A-Za-z]:\//.test(destination);
  if (isAbsolute) {
    const absolutePath = normalizeMarkdownPath(destination);
    if (!absolutePath) return null;
    const windowsPath = /^[A-Za-z]:\//.test(normalizedRoot);
    const root = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot;
    const candidate = windowsPath ? absolutePath.toLowerCase() : absolutePath;
    if (candidate === root) return null;
    const prefix = root.endsWith("/") ? root : `${root}/`;
    return candidate.startsWith(prefix) ? absolutePath.slice(prefix.length) : null;
  }
  return normalizeMarkdownPath(destination);
}

function normalizeMarkdownPath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const drive = normalized.match(/^([A-Za-z]:)\//)?.[1] ?? "";
  const absolute = normalized.startsWith("/");
  const rest = drive ? normalized.slice(3) : absolute ? normalized.slice(1) : normalized;
  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) {
        if (!absolute && !drive) return null;
        continue;
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const prefix = drive ? `${drive}/` : absolute ? "/" : "";
  return `${prefix}${segments.join("/")}` || (prefix || null);
}
