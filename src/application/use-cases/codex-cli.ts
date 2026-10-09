import type { CodexArchiveStoragePort, CodexCliOpenedSession, CodexCliPort, CodexCliSessionPort, CodexCliSkillPort, CodexCliThreadRecord } from "../ports/codex-cli.js";
import type { AvailableSkill, SkillInputPreparation, SkillSelection } from "../ports/skills.js";
import { validateThreadId as validateThreadIdValue } from "../validation/thread-id.js";

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
    validateThreadIdValue(threadId);
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
  constructor(
    private readonly codex: CodexCliPort,
    private readonly sessions: CodexCliSessionPort,
    private readonly skills: CodexCliSkillPort,
  ) {}

  validateThreadId(threadId: string): void {
    validateThreadIdValue(threadId);
  }

  validateTarget(target: string): void {
    this.codex.validateTarget(target);
  }

  openSession(target: string, threadId: string): Promise<CodexCliOpenedSession> {
    this.validateThreadId(threadId);
    return this.sessions.openSession(target, threadId);
  }

  async buildSkillInput(target: string, threadId: string, selection: SkillSelection, request: string): Promise<SkillInputPreparation> {
    this.validateThreadId(threadId);
    const catalog = await this.skills.listCliSkills(target, threadId);
    const resolution = resolveSkill(catalog.skills, selection);
    if (resolution.status !== "selected") return resolution;
    if (!resolution.skill.enabled) return { status: "disabled", skill: resolution.skill };
    return {
      status: "ready",
      inputText: await this.skills.buildSkillInput(target, threadId, resolution.skill, request),
      skill: resolution.skill,
    };
  }
}

function resolveSkill(skills: AvailableSkill[], selection: SkillSelection):
  | { status: "selected"; skill: AvailableSkill }
  | Exclude<SkillInputPreparation, { status: "ready" | "disabled" }> {
  const matches = skills.filter((skill) => skill.name === selection.name && (!selection.provider || skill.provider === selection.provider));
  if (matches.length > 1) {
    return { status: "ambiguous", name: selection.name, skills: matches };
  }
  const skill = matches[0];
  return skill ? { status: "selected", skill } : { status: "notFound" };
}
