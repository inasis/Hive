import type { ReactNode } from "react";

export type FileSyntaxLanguage = "javascript" | "python" | "shell" | "json" | "jsonc" | "markup" | "css" | "sql" | "data" | "c-like";
type TokenKind = "keyword" | "string" | "number" | "comment" | "function" | "constant" | "property" | "operator" | "punctuation" | "tag" | "attribute";

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

const KEYWORDS: Record<FileSyntaxLanguage, ReadonlySet<string>> = {
  javascript: new Set("abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let module namespace new null number object of package private protected public readonly require return satisfies set static string super switch symbol this throw try type typeof undefined unique unknown var void while with yield".split(" ")),
  python: new Set("and as assert async await break class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield".split(" ")),
  shell: new Set("alias bg bind break builtin caller case cd command compgen complete continue coproc declare dirs disown do done echo elif else enable esac eval exec exit export false fc fg fi for function getopts hash help history if in jobs kill let local logout mapfile popd printf pushd pwd read readonly return select set shift shopt source suspend test then time times trap true type typeset ulimit umask unalias unset until wait while".split(" ")),
  json: new Set(),
  jsonc: new Set(),
  markup: new Set(),
  css: new Set("important media supports import font-face keyframes layer container scope".split(" ")),
  sql: new Set("add all alter analyze and any array as asc authorization begin between by case cast check collate column commit constraint create cross current_date current_time database default delete desc distinct do drop else end except exists explain false fetch for foreign from full grant group having in index inner insert intersect into is join lateral left like limit natural not null offset on only or order outer over partition primary procedure references returning right rollback row rows select set table then to transaction true truncate union unique update using values view when where with".split(" ")),
  data: new Set(),
  "c-like": new Set("abstract alignas alignof as asm assert auto await bool boolean break byte case catch char class const constexpr continue crate default defer delegate delete do double dyn else enum explicit export extends extern false final finally float for foreach friend from func function get go goto if implements import in inline init int interface internal is let long module mut namespace native new noexcept null nullptr object operator out override package params partial private protected public record ref register return sbyte sealed self short signed sizeof static strictfp string struct super switch synchronized template this throw throws trait transmute true try type typeof uint ulong unchecked unsafe ushort using var virtual void volatile where while yield".split(" ")),
};

const CONSTANTS: Record<FileSyntaxLanguage, ReadonlySet<string>> = {
  javascript: new Set("false null true undefined NaN Infinity".split(" ")),
  python: new Set("False None True".split(" ")),
  shell: new Set("false true".split(" ")),
  json: new Set("false null true".split(" ")),
  jsonc: new Set("false null true".split(" ")),
  markup: new Set(),
  css: new Set("important".split(" ")),
  sql: new Set("false null true".split(" ")),
  data: new Set("false no null off on true yes".split(" ")),
  "c-like": new Set("false null nullptr true".split(" ")),
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
  const result: ReactNode[] = [];
  const append = (text: string, kind?: TokenKind) => {
    if (!text) return;
    result.push(kind ? <span className={`file-code-${kind}`} key={result.length}>{text}</span> : text);
  };
  let index = 0;

  while (index < source.length) {
    const blockComment = readBlockComment(source, index, language);
    if (blockComment) {
      append(blockComment.text, "comment");
      index = blockComment.end;
      continue;
    }

    const lineComment = readLineComment(source, index, language);
    if (lineComment) {
      append(lineComment.text, "comment");
      index = lineComment.end;
      continue;
    }

    if (language === "markup" && source[index] === "<") {
      const end = appendMarkupTag(source, index, append);
      if (end !== null) {
        index = end;
        continue;
      }
    }

    const quoted = readQuotedString(source, index, language);
    if (quoted) {
      append(quoted.text, "string");
      index = quoted.end;
      continue;
    }

    const current = source[index] ?? "";
    if (/\d/.test(current) && (index === 0 || !/[\w$]/.test(source[index - 1] ?? ""))) {
      const number = source.slice(index).match(/^(?:0[xX][\da-fA-F](?:_?[\da-fA-F])*|0[bB][01](?:_?[01])*|\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?n?)/)?.[0];
      if (number) {
        append(number, "number");
        index += number.length;
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(current)) {
      const word = source.slice(index).match(/^[A-Za-z_$][\w$]*/)?.[0] ?? current;
      const normalizedWord = language === "sql" ? word.toLowerCase() : word;
      const next = nextNonWhitespace(source, index + word.length);
      const followsColon = source[next] === ":";
      const kind = CONSTANTS[language].has(normalizedWord) ? "constant"
        : KEYWORDS[language].has(normalizedWord) ? "keyword"
          : followsColon ? "property"
            : source[next] === "(" ? "function" : undefined;
      append(word, kind);
      index += word.length;
      continue;
    }

    if (/[{}()[\],.;]/.test(current)) {
      append(current, "punctuation");
      index += 1;
      continue;
    }

    if (/[+*/%=!<>&|^~?:-]/.test(current)) {
      append(current, "operator");
      index += 1;
      continue;
    }

    append(current);
    index += 1;
  }

  return result;
}

function readBlockComment(source: string, index: number, language: FileSyntaxLanguage): { text: string; end: number } | null {
  const marker = language === "markup" ? ["<!--", "-->"] : ["/*", "*/"];
  const supportsBlockComments = language === "javascript" || language === "jsonc" || language === "markup" || language === "css" || language === "sql" || language === "c-like";
  if (!supportsBlockComments || !source.startsWith(marker[0], index)) return null;
  const closeIndex = source.indexOf(marker[1], index + marker[0].length);
  const end = closeIndex < 0 ? source.length : closeIndex + marker[1].length;
  return { text: source.slice(index, end), end };
}

function readLineComment(source: string, index: number, language: FileSyntaxLanguage): { text: string; end: number } | null {
  const markers = language === "python" || language === "shell" || language === "data" ? ["#"]
    : language === "jsonc" || language === "javascript" || language === "c-like" ? ["//"]
      : language === "sql" ? ["--"]
        : [];
  const marker = markers.find((candidate) => source.startsWith(candidate, index));
  if (!marker) return null;
  let end = source.indexOf("\n", index);
  if (end < 0) end = source.length;
  return { text: source.slice(index, end), end };
}

function readQuotedString(source: string, index: number, language: FileSyntaxLanguage): { text: string; end: number } | null {
  const quote = source[index];
  if (quote !== "'" && quote !== '"' && !(quote === "`" && language === "javascript")) return null;
  const triple = language === "python" && source.startsWith(quote.repeat(3), index);
  const delimiter = triple ? quote.repeat(3) : quote;
  let cursor = index + delimiter.length;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source.startsWith(delimiter, cursor)) {
      cursor += delimiter.length;
      break;
    }
    if (!triple && quote !== "`" && source[cursor] === "\n") break;
    cursor += 1;
  }
  return { text: source.slice(index, cursor), end: cursor };
}

function appendMarkupTag(source: string, start: number, append: (text: string, kind?: TokenKind) => void): number | null {
  const match = source.slice(start).match(/^<(\/)?([A-Za-z][A-Za-z\d:._-]*)/);
  if (!match) return null;
  append("<", "punctuation");
  if (match[1]) append("/", "punctuation");
  append(match[2] ?? "", "tag");
  let index = start + match[0].length;

  while (index < source.length) {
    if (/\s/.test(source[index] ?? "")) {
      const whitespace = source.slice(index).match(/^\s+/)?.[0] ?? " ";
      append(whitespace);
      index += whitespace.length;
      continue;
    }
    if (source.startsWith("/>", index)) {
      append("/>", "punctuation");
      return index + 2;
    }
    if (source[index] === ">") {
      append(">", "punctuation");
      return index + 1;
    }
    if (source[index] === "=") {
      append("=", "operator");
      index += 1;
      continue;
    }
    const quote = readQuotedString(source, index, "markup");
    if (quote) {
      append(quote.text, "string");
      index = quote.end;
      continue;
    }
    const attribute = source.slice(index).match(/^[^\s=/>]+/)?.[0];
    if (attribute) {
      append(attribute, "attribute");
      index += attribute.length;
      continue;
    }
    append(source[index] ?? "");
    index += 1;
  }
  return index;
}

function nextNonWhitespace(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
  return index;
}
