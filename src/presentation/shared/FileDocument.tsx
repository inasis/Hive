import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WorkspaceFileText } from "./bridge";
import { MermaidMarkdownPre } from "./MermaidMarkdown";
import { basename } from "./path-name";
import { fileSyntaxLanguageFromName, fileSyntaxLanguageFromPath, highlightFileCode } from "./file-syntax";

const markdownComponents: Components = {
  a: ({ href, title, children }) => {
    const opensNewTab = Boolean(href && /^https?:/i.test(href));
    return <a href={href} title={title} target={opensNewTab ? "_blank" : undefined} rel={opensNewTab ? "noopener noreferrer" : undefined}>{children}</a>;
  },
  code: ({ className, children }) => {
    const languageName = className?.match(/(?:^|\s)language-([^\s]+)/)?.[1];
    const language = languageName ? fileSyntaxLanguageFromName(languageName) : null;
    return <code className={className}>{language ? highlightFileCode(nodeText(children), language) : children}</code>;
  },
  pre: MermaidMarkdownPre,
  table: ({ children }) => <div className="markdown-table-wrap"><table>{children}</table></div>,
};

export function FileDocument({ file }: { file: WorkspaceFileText }) {
  const content = file.content || "(빈 파일)";
  const fileLanguage = fileSyntaxLanguageFromPath(file.path);
  const isMarkdown = fileLanguage === "markdown";
  const language = fileLanguage === "markdown" ? null : fileLanguage;

  return <section className="file-preview file-document" aria-label={`파일 내용: ${file.path}`}>
    <div className="file-preview-heading"><b>{basename(file.path)}</b><span title={file.path}>{file.path} · {formatBytes(file.bytes)}</span></div>
    <div className={`file-document-content${isMarkdown ? " file-document-markdown markdown-body" : ""}`}>
      {isMarkdown
        ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
        : <pre className="file-document-source-code"><code>{highlightFileCode(content, language)}</code></pre>}
    </div>
  </section>;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return "";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
