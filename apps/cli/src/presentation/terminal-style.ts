export const colorsEnabled =
  process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";

export const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  red: "\u001b[31m",
} as const;

export function contentWidth(reserved: number): number {
  return Math.max(20, (process.stdout.columns ?? 80) - reserved);
}

export function paint(code: string, text: string): string {
  return colorsEnabled ? `${code}${text}${ansi.reset}` : text;
}
