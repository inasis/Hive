import type { ReactNode } from "react";
import { tokenizeFileCode } from "./file-syntax-tokenizer.js";
import type { FileSyntaxLanguage } from "./file-syntax-language-rules.js";
export type { FileSyntaxLanguage } from "./file-syntax-language-rules.js";

const LANGUAGE_BY_EXTENSION: Record<string, FileSyntaxLanguage | "markdown"> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "javascript", tsx: "javascript", mts: "javascript", cts: "javascript",
  py: "python", pyw: "python",
  sh: "shell", bash: "shell", zsh: "shell",
  json: "json", jsonc: "jsonc", json5: "jsonc",
  html: "markup", htm: "markup", xhtml: "markup", xml: "markup", svg: "markup",
  css: "css", scss: "css", less: "css",
  sql: "sql",
  yml: "data", yaml: "data", toml: "data", ini: "data", properties: "data",
  c: "c-like", h: "c-like", cc: "c-like", cpp: "c-like", cxx: "c-like", hpp: "c-like", hxx: "c-like",
  java: "c-like", kt: "c-like", kts: "c-like", go: "c-like", rs: "c-like", swift: "c-like",
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown",
};

const LANGUAGE_BY_NAME: Record<string, FileSyntaxLanguage | "markdown"> = {
  ...LANGUAGE_BY_EXTENSION,
  javascript: "javascript", js: "javascript", jsx: "javascript", typescript: "javascript", ts: "javascript", tsx: "javascript",
  python: "python", py: "python",
  shell: "shell", bash: "shell", sh: "shell", zsh: "shell",
  json: "json", jsonc: "jsonc", json5: "jsonc",
  html: "markup", xml: "markup", svg: "markup", markup: "markup",
  css: "css", scss: "css", less: "css",
  sql: "sql",
  yaml: "data", yml: "data", toml: "data", ini: "data",
  c: "c-like", cpp: "c-like", cxx: "c-like", csharp: "c-like", java: "c-like", kotlin: "c-like", kt: "c-like", go: "c-like", rust: "c-like", rs: "c-like", swift: "c-like",
  markdown: "markdown", md: "markdown",
};

export function fileSyntaxLanguageFromPath(path: string): FileSyntaxLanguage | "markdown" | null {
  const filename = path.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
  if (filename === "dockerfile" || filename === "makefile") return "shell";
  if (filename.startsWith(".env")) return "data";
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}

export function fileSyntaxLanguageFromName(name: string): FileSyntaxLanguage | null {
  const normalized = name.toLowerCase().replace(/^language-/, "");
  const language = LANGUAGE_BY_NAME[normalized];
  return language && language !== "markdown" ? language : null;
}

export function highlightFileCode(source: string, language: FileSyntaxLanguage | null): ReactNode {
  if (!language || !source) return source;
  return tokenizeFileCode(source, language).map(({ text, kind }, index) => kind
    ? <span className={`file-code-${kind}`} key={index}>{text}</span>
    : text);
}
