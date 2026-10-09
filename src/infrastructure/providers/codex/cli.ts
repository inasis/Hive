import type { CodexArchiveSnapshot, CodexCliPort, CodexCliThreadRecord } from "../../../application/ports/codex-cli.js";
import { assertSshTarget } from "../../transport/workspace-target.js";
import { CodexAppServerApi, type CodexThread } from "./app-server.js";
import { toCodexArchiveJsonObject } from "./archive-mapper.js";

/** Stateless Codex app-server operations used by the standalone CLI. */
export class CodexCliAdapter implements CodexCliPort {
  validateTarget(target: string): void {
    assertSshTarget(target);
  }

  async listThreads(target: string, options: { cwd?: string; limit: number }): Promise<CodexCliThreadRecord[]> {
    const api = await CodexAppServerApi.connect(target);
    try {
      const threads: CodexThread[] = await api.listThreads(options);
      return threads;
    } finally {
      await api.close();
    }
  }

  async readThreadForArchive(target: string, threadId: string): Promise<CodexArchiveSnapshot> {
    const api = await CodexAppServerApi.connect(target);
    try {
      const threadRead = await api.readThread(threadId);
      const thread = asObject(threadRead.thread);
      if (!thread) throw new Error("Codex returned an invalid thread/read response");
      return {
        targetLabel: archiveTargetLabel(target),
        cwd: typeof thread.cwd === "string" ? thread.cwd : null,
        threadRead: toCodexArchiveJsonObject(threadRead),
      };
    } finally {
      await api.close();
    }
  }
}

function archiveTargetLabel(target: string): string {
  return target;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
