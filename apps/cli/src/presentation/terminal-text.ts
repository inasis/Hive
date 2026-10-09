/** Remove terminal control sequences before forwarding provider output to a user's terminal. */
export function sanitizeTerminalChunk(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}

/** Sanitize a single-line label or detail before rendering it in the interactive CLI. */
export function sanitizeTerminalText(value: string): string {
  return sanitizeTerminalChunk(value).replace(/[\r\n\t]/g, " ");
}

/** Truncate text using terminal display columns, including wide CJK and emoji characters. */
export function fitTerminalText(value: string, maximum: number): string {
  value = sanitizeTerminalText(value);
  if (visibleLength(value) <= maximum) return value;
  if (maximum <= 1) return "…";
  let fitted = "";
  for (const character of value) {
    if (visibleLength(fitted) + characterWidth(character) > maximum - 1) break;
    fitted += character;
  }
  return `${fitted}…`;
}

function visibleLength(value: string): number {
  return [...sanitizeTerminalText(value)].reduce((width, character) => width + characterWidth(character), 0);
}

function characterWidth(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  if (code === 0 || code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (/\p{Mark}/u.test(character) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}
