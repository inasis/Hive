export type FileSyntaxLanguage = "javascript" | "python" | "shell" | "json" | "jsonc" | "markup" | "css" | "sql" | "data" | "c-like";
export type FileSyntaxTokenKind = "keyword" | "string" | "number" | "comment" | "function" | "constant" | "property" | "operator" | "punctuation" | "tag" | "attribute";

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

export function classifyFileSyntaxIdentifier(
  word: string,
  language: FileSyntaxLanguage,
  followsColon: boolean,
  followsCall: boolean,
): FileSyntaxTokenKind | undefined {
  const normalizedWord = language === "sql" ? word.toLowerCase() : word;
  return CONSTANTS[language].has(normalizedWord) ? "constant"
    : KEYWORDS[language].has(normalizedWord) ? "keyword"
      : followsColon ? "property"
        : followsCall ? "function" : undefined;
}

export function readFileSyntaxBlockComment(source: string, index: number, language: FileSyntaxLanguage): { text: string; end: number } | null {
  const marker = language === "markup" ? ["<!--", "-->"] : ["/*", "*/"];
  const supportsBlockComments = language === "javascript" || language === "jsonc" || language === "markup" || language === "css" || language === "sql" || language === "c-like";
  if (!supportsBlockComments || !source.startsWith(marker[0], index)) return null;
  const closeIndex = source.indexOf(marker[1], index + marker[0].length);
  const end = closeIndex < 0 ? source.length : closeIndex + marker[1].length;
  return { text: source.slice(index, end), end };
}

export function readFileSyntaxLineComment(source: string, index: number, language: FileSyntaxLanguage): { text: string; end: number } | null {
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
