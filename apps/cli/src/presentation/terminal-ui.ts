import { fitTerminalText, sanitizeTerminalText } from "./terminal-text.js";
import { ansi, colorsEnabled, contentWidth, paint } from "./terminal-style.js";

type SessionHeader = {
  target: string;
  threadId: string;
  title?: string;
  cwd?: string;
  skillCount: number;
};

/** Compact chat-oriented session heading, inspired by OpenCode and Codex TUIs. */
export function renderSessionHeader(header: SessionHeader): void {
  const title = fitTerminalText(header.title || header.threadId, contentWidth(4));
  const target = fitTerminalText(header.target, contentWidth(4));
  const location = header.cwd ? fitTerminalText(header.cwd, contentWidth(4)) : undefined;

  process.stdout.write(`\n${paint(ansi.green, "●")} ${paint(ansi.bold, "Codex session")}  ${paint(ansi.dim, "connected")}\n`);
  process.stdout.write(`  ${paint(ansi.bold, title)}\n`);
  process.stdout.write(`  ${paint(ansi.dim, target)}\n`);
  if (location) process.stdout.write(`  ${paint(ansi.dim, location)}\n`);
  process.stdout.write(`  ${paint(ansi.cyan, String(header.skillCount))} ${paint(ansi.dim, `skills  ·  /skills to browse`) }\n`);
  process.stdout.write(`${paint(ansi.dim, "─".repeat(Math.min(44, contentWidth(0))))}\n\n`);
}

export function renderAssistantStart(): string {
  return `\n${paint(ansi.magenta, "●")} ${paint(ansi.dim, "Codex")}\n`;
}

export function renderTurnComplete(status: string): string {
  const normalized = sanitizeTerminalText(status);
  const color = status === "completed" ? ansi.green : status === "failed" ? ansi.red : ansi.yellow;
  const icon = status === "completed" ? "✓" : status === "failed" ? "×" : "·";
  return `${paint(color, icon)} ${paint(ansi.dim, normalized)}\n`;
}

export function renderActivity(label: string, detail?: string): string {
  const friendlyLabel = activityLabel(label);
  const firstLine = `  ${paint(ansi.yellow, "◦")} ${paint(ansi.bold, sanitizeTerminalText(friendlyLabel))}`;
  const suffix = detail ? `\n    ${paint(ansi.dim, fitTerminalText(detail, contentWidth(4)))}` : "";
  return `${firstLine}${suffix}\n`;
}

export function renderNotice(message: string, kind: "info" | "warning" | "error" = "info"): string {
  const color = kind === "error" ? ansi.red : kind === "warning" ? ansi.yellow : ansi.cyan;
  const icon = kind === "error" ? "×" : kind === "warning" ? "!" : "·";
  return `${paint(color, icon)} ${sanitizeTerminalText(message)}\n`;
}

export function renderInputPrompt(): string {
  // readline treats these markers as zero-width around ANSI prompt styling.
  return colorsEnabled ? `\u0001${ansi.cyan}\u0002›\u0001${ansi.reset}\u0002 ` : "› ";
}

export function renderQuestionPrompt(question: string): string {
  const marker = colorsEnabled ? `\u0001${ansi.yellow}\u0002?\u0001${ansi.reset}\u0002` : "?";
  return `${marker} ${sanitizeTerminalText(question)} `;
}

export function renderHelp(): void {
  process.stdout.write(`\n${paint(ansi.bold, "Hive commands")}\n\n`);
  process.stdout.write(`  ${paint(ansi.cyan, "/skills [filter]")}       Browse remote Codex and Pi skills\n`);
  process.stdout.write(`  ${paint(ansi.cyan, "/skill:<name>")}         Invoke a skill; add a request after its name\n`);
  process.stdout.write(`  ${paint(ansi.cyan, "/skill:pi:<name>")}      Choose a Pi skill when names overlap\n`);
  process.stdout.write(`  ${paint(ansi.cyan, "/skill:codex:<name>")}   Choose a Codex skill when names overlap\n`);
  process.stdout.write(`  ${paint(ansi.cyan, "/quit  /exit")}          Close this connection\n\n`);
  process.stdout.write(`  Other input goes to the resumed Codex session. Codex prompts such as ${paint(ansi.dim, "$skill-creator")} also work.\n\n`);
}

function activityLabel(label: string): string {
  if (label === "COMMAND") return "Running command";
  if (label === "FILE CHANGES") return "Preparing file changes";
  return label.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}
