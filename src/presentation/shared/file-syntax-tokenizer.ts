import {
  classifyFileSyntaxIdentifier,
  readFileSyntaxBlockComment,
  readFileSyntaxLineComment,
} from "./file-syntax-language-rules.js";
import type { FileSyntaxLanguage, FileSyntaxTokenKind } from "./file-syntax-language-rules.js";

export type FileSyntaxToken = { text: string; kind?: FileSyntaxTokenKind };

export function tokenizeFileCode(source: string, language: FileSyntaxLanguage): FileSyntaxToken[] {
  if (!source) return [];
  const result: FileSyntaxToken[] = [];
  const append = (text: string, kind?: FileSyntaxTokenKind) => {
    if (!text) return;
    result.push(kind ? { text, kind } : { text });
  };
  let index = 0;

  while (index < source.length) {
    const blockComment = readFileSyntaxBlockComment(source, index, language);
    if (blockComment) {
      append(blockComment.text, "comment");
      index = blockComment.end;
      continue;
    }

    const lineComment = readFileSyntaxLineComment(source, index, language);
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
      const next = nextNonWhitespace(source, index + word.length);
      const followsColon = source[next] === ":";
      const kind = classifyFileSyntaxIdentifier(word, language, followsColon, source[next] === "(");
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

function appendMarkupTag(source: string, start: number, append: (text: string, kind?: FileSyntaxTokenKind) => void): number | null {
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
