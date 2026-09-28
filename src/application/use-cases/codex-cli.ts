import type { CodexArchiveStoragePort, CodexCliOpenedSession, CodexCliPort, CodexCliSessionPort, CodexCliThreadRecord } from "../ports/codex-cli.js";
import type { AvailableSkill } from "../ports/skills.js";
import { validateThreadId } from "./provider-sessions.js";

/** Codex-specific CLI workflows, independent of app-server and filesystem APIs. */
export class CodexCliUseCases {
  constructor(
    private readonly codex: CodexCliPort,
    private readonly archives: CodexArchiveStoragePort,
  ) {}

  listThreads(target: string, options: { cwd?: string; limit: number }): Promise<CodexCliThreadRecord[]> {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
      throw new Error("--limit must be an integer from 1 to 500");
    }
    return this.codex.listThreads(target, options);
  }

  async importThread(target: string, threadId: string, options: { cwd?: string; outDir?: string }): Promise<string> {
    validateThreadId(threadId);
    const snapshot = await this.codex.readThreadForArchive(target, threadId);
    const filePath = await this.archives.save({
      format: "hive-codex-archive/v1",
      provider: "codex",
      importedAt: new Date().toISOString(),
      source: { sshTarget: snapshot.targetLabel, threadId, cwd: snapshot.cwd ?? options.cwd ?? null },
      threadRead: snapshot.threadRead,
    }, options.outDir ?? this.archives.defaultDirectory());
    return filePath;
  }

  defaultArchiveDirectory(): string {
    return this.archives.defaultDirectory();
  }
}

/** Interactive Codex session actions shared by the CLI interface and provider adapter. */
export class CodexCliSessionUseCases {
  constructor(private readonly codex: CodexCliPort, private readonly sessions: CodexCliSessionPort) {}

  validateTarget(target: string): void {
    this.codex.validateTarget(target);
  }

  openSession(target: string, threadId: string): Promise<CodexCliOpenedSession> {
    validateThreadId(threadId);
    return this.sessions.openSession(target, threadId);
  }

  async buildSkillInput(target: string, threadId: string, selector: string, request: string): Promise<{ inputText: string; skill: AvailableSkill }> {
    validateThreadId(threadId);
    const catalog = await this.sessions.listCliSkills(target, threadId);
    const skill = resolveSkill(catalog.skills, selector);
    if (!skill) throw new Error(`No available skill named '${selector}'. Use /skills to browse.`);
    if (!skill.enabled) throw new Error(`The '${skill.name}' skill is disabled.`);
    return { inputText: await this.sessions.buildSkillInput(target, threadId, skill, request), skill };
  }
}

function resolveSkill(skills: AvailableSkill[], selector: string): AvailableSkill | undefined {
  const [prefix, ...nameParts] = selector.split(":");
  const provider = prefix?.toLowerCase();
  const qualifiedProvider = ["codex", "pi", "shared"].includes(provider ?? "") ? provider : undefined;
  const name = qualifiedProvider ? nameParts.join(":") : selector;
  const matches = skills.filter((skill) => skill.name === name && (!qualifiedProvider || skill.provider.toLowerCase() === qualifiedProvider));
  if (matches.length > 1) {
    const choices = matches.map((skill) => `/skill:${skill.provider.toLowerCase()}:${skill.name}`).join("  ");
    throw new Error(`Skill name '${name}' is ambiguous. Choose ${choices}`);
  }
  return matches[0];
}
