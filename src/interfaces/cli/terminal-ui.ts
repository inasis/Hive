import type { AvailableSkill, SkillProvider } from "../../application/ports/skills.js";

type SessionHeader = {
  target: string;
  threadId: string;
  title?: string;
  cwd?: string;
  skillCount: number;
};

const colorsEnabled =
  process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";

const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  red: "\u001b[31m",
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

export function renderSkillCatalog(skills: AvailableSkill[], filter: string, warnings: string[]): void {
  const needle = filter.trim().toLowerCase();
  const matches = skills.filter((skill) =>
    [skill.name, skill.description, skill.provider, skill.scope, skill.path]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
  const visible = matches.slice(0, 36);
  const duplicateNames = findDuplicateNames(matches);

  process.stdout.write(`\n${paint(ansi.bold, "Skills")}  ${paint(ansi.dim, `${matches.length} available`)}`);
  if (needle) process.stdout.write(`  ${paint(ansi.dim, `· filtered by “${sanitizeTerminalText(filter)}”`)}`);
  process.stdout.write("\n\n");

  if (visible.length === 0) {
    process.stdout.write(`  ${paint(ansi.dim, "No matching skills. Try /skills <filter>.")}\n`);
  } else {
    let lastGroup = "";
    const width = contentWidth(7);
    for (const skill of visible) {
      const group = `${skill.provider}  ·  ${skill.scope}`;
      if (group !== lastGroup) {
        if (lastGroup) process.stdout.write("\n");
        process.stdout.write(`  ${providerMark(skill.provider)}  ${paint(ansi.dim, sanitizeTerminalText(skill.scope))}\n`);
        lastGroup = group;
      }

      const qualifier = duplicateNames.has(skill.name) ? `${skill.provider.toLowerCase()}:` : "";
      const command = fitTerminalText(`/skill:${qualifier}${skill.name}`, width);
      process.stdout.write(`    ${paint(ansi.cyan, "›")} ${paint(ansi.bold, command)}${skill.enabled ? "" : `  ${paint(ansi.red, "disabled")}`}\n`);
      process.stdout.write(`      ${fitTerminalText(skill.description || "No description", width)}\n`);
      process.stdout.write(`      ${paint(ansi.dim, fitTerminalText(shortPath(skill.path), width))}\n`);
    }
    if (matches.length > visible.length) {
      process.stdout.write(`\n  ${paint(ansi.dim, `${matches.length - visible.length} more · narrow the list with /skills <filter>`)}\n`);
    }
  }

  for (const warning of warnings) process.stdout.write(`\n${renderNotice(warning, "warning")}`);
  process.stdout.write(`\n${paint(ansi.dim, "Type a /skill: command to invoke one. Skill files remain on the remote host.")}\n\n`);
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

export function sanitizeTerminalChunk(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
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

export function completerForSkills(skills: AvailableSkill[]): (line: string) => [string[], string] {
  const commands = new Set(["/help", "/skills", "/quit", "/exit"]);
  const duplicates = findDuplicateNames(skills);
  for (const skill of skills) {
    if (!skill.enabled) continue;
    const qualifier = duplicates.has(skill.name) ? `${skill.provider.toLowerCase()}:` : "";
    commands.add(`/skill:${qualifier}${skill.name}`);
  }

  return (line) => {
    const matches = [...commands].filter((command) => command.startsWith(line));
    return [matches, line];
  };
}

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

function providerMark(provider: SkillProvider): string {
  if (provider === "Codex") return paint(ansi.cyan, "CODEX");
  if (provider === "Pi") return paint(ansi.magenta, "PI");
  return paint(ansi.green, "SHARED");
}

function activityLabel(label: string): string {
  if (label === "COMMAND") return "Running command";
  if (label === "FILE CHANGES") return "Preparing file changes";
  return label.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function findDuplicateNames(skills: AvailableSkill[]): Set<string> {
  const counts = new Map<string, number>();
  for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function shortPath(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function contentWidth(reserved: number): number {
  return Math.max(20, (process.stdout.columns ?? 80) - reserved);
}

function visibleLength(value: string): number {
  return [...sanitizeTerminalText(value)].reduce((width, character) => width + characterWidth(character), 0);
}

function sanitizeTerminalText(value: string): string {
  return sanitizeTerminalChunk(value).replace(/[\r\n\t]/g, " ");
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

function paint(code: string, text: string): string {
  return colorsEnabled ? `${code}${text}${ansi.reset}` : text;
}
