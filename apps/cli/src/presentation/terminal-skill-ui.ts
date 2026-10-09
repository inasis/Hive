import type { AvailableSkill, SkillProvider } from "../../../../src/application/ports/skills.js";
import { fitTerminalText, sanitizeTerminalText } from "./terminal-text.js";
import { ansi, contentWidth, paint } from "./terminal-style.js";
import { renderNotice } from "./terminal-ui.js";

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

function providerMark(provider: SkillProvider): string {
  if (provider === "Codex") return paint(ansi.cyan, "CODEX");
  if (provider === "Pi") return paint(ansi.magenta, "PI");
  return paint(ansi.green, "SHARED");
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
