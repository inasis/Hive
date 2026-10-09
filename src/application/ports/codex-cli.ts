import type { AvailableSkill, SkillCatalog } from "./skills.js";

/** Stable session summary exposed by the Codex CLI adapter and `hive list --json`. */
export type CodexCliThreadRecord = {
  id: string;
  cwd?: string;
  title?: string;
  name?: string;
  preview?: string;
  updatedAt?: string | number;
};

export type CodexArchiveJsonValue = null | boolean | number | string | CodexArchiveJsonValue[] | CodexArchiveJsonObject;
export type CodexArchiveJsonObject = { [key: string]: CodexArchiveJsonValue };

export type CodexArchiveSnapshot = {
  targetLabel: string;
  cwd: string | null;
  threadRead: CodexArchiveJsonObject;
};

export type ImportedCodexArchive = {
  format: "hive-codex-archive/v1";
  provider: "codex";
  importedAt: string;
  source: {
    sshTarget: string;
    threadId: string;
    cwd: string | null;
  };
  /** Opaque app-server history retained so an imported archive stays lossless. */
  threadRead: CodexArchiveJsonObject;
};

export interface CodexCliPort {
  validateTarget(target: string): void;
  listThreads(target: string, options: { cwd?: string; limit: number }): Promise<CodexCliThreadRecord[]>;
  readThreadForArchive(target: string, threadId: string): Promise<CodexArchiveSnapshot>;
}

export type CodexCliOpenedSession = {
  targetLabel: string;
  title?: string;
  cwd?: string;
  skillCatalog: SkillCatalog;
};

export type CodexCliEvent = {
  target: string;
  threadId: string;
} & (
  | { type: "commandStarted"; command: string }
  | { type: "fileChangesStarted" }
  | { type: "assistantDelta"; text: string }
  | { type: "turnCompleted"; status: string; error?: string }
  | { type: "warning"; message: string }
  | { type: "commandApproval"; requestId: number | string; command: string; cwd?: string; reason?: string; itemId?: string }
  | { type: "fileApproval"; requestId: number | string; reason?: string; itemId?: string }
);

/** Codex thread opening needed by the interactive CLI, without app-server DTOs. */
export interface CodexCliSessionPort {
  openSession(target: string, threadId: string): Promise<CodexCliOpenedSession>;
}

/** Codex CLI skill lookup and prompt preparation operations. */
export interface CodexCliSkillPort {
  listCliSkills(target: string, threadId: string): Promise<SkillCatalog>;
  buildSkillInput(target: string, threadId: string, skill: AvailableSkill, request: string): Promise<string>;
}

export interface CodexArchiveStoragePort {
  defaultDirectory(): string;
  save(archive: ImportedCodexArchive, directory?: string): Promise<string>;
}
