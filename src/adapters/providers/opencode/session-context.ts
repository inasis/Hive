import { ensureOpenCodeServer, stopManagedOpenCodeServer } from "./server.js";
import { OpenCodeProviderConnection } from "./provider.js";
import type { OpenCodeModel } from "./model-mapper.js";
import type { OpenCodeSkill } from "./types.js";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";

export type OpenCodeProviderSession = {
  connection: OpenCodeProviderConnection;
  openedThreadIds: Set<string>;
  settingsByThread: Map<string, { model: string }>;
  modelsByThread: Map<string, OpenCodeModel[]>;
  cwdByThread: Map<string, string>;
  skillsByThread: Map<string, OpenCodeSkill[]>;
};

/** Owns OpenCode connections and their per-target session state for the daemon lifetime. */
export class OpenCodeSessionContext {
  private readonly sessions = new Map<string, OpenCodeProviderSession>();
  private readonly connecting = new Map<string, Promise<OpenCodeProviderSession>>();

  async getOrConnect(target: string): Promise<OpenCodeProviderSession> {
    const existing = this.sessions.get(target);
    if (existing) return existing;
    const pending = this.connecting.get(target);
    if (pending) return pending;

    const task = (async () => {
      let connection: OpenCodeProviderConnection;
      try {
        const server = await ensureOpenCodeServer();
        connection = await OpenCodeProviderConnection.connect(server.endpoint, server.username, server.password ?? "");
      } catch (error) {
        const endpoint = process.env.HIVE_OPENCODE_URL?.trim() || "http://127.0.0.1:4096";
        throw new Error(`Hive 실행 host에서 OpenCode 서버 ${endpoint}에 연결하지 못했습니다: ${errorMessage(error)}`);
      }
      const session: OpenCodeProviderSession = {
        connection,
        openedThreadIds: new Set(),
        settingsByThread: new Map(),
        modelsByThread: new Map(),
        cwdByThread: new Map(),
        skillsByThread: new Map(),
      };
      this.sessions.set(target, session);
      return session;
    })();
    this.connecting.set(target, task);
    try {
      return await task;
    } finally {
      this.connecting.delete(target);
    }
  }

  require(target: string): OpenCodeProviderSession {
    const session = this.sessions.get(target);
    if (!session) throw new Error("OpenCode 연결이 만료되었습니다. 연결 설정에서 다시 연결하세요.");
    return session;
  }

  async loadSkills(
    session: OpenCodeProviderSession,
    threadId: string,
    directory: string | undefined,
  ): Promise<{ skills: OpenCodeSkill[]; warnings: string[] }> {
    try {
      const skills = await session.connection.listSkills(directory || undefined);
      session.skillsByThread.set(threadId, skills);
      return { skills, warnings: [] };
    } catch (error) {
      session.skillsByThread.set(threadId, []);
      return { skills: [], warnings: [`OpenCode 스킬 목록을 가져오지 못했습니다: ${errorMessage(error)}`] };
    }
  }

  async disconnect(target: string): Promise<void> {
    const session = this.sessions.get(target);
    if (!session) return;
    this.sessions.delete(target);
    session.connection.close();
  }

  async warmLocal(): Promise<void> {
    await this.getOrConnect(LOCAL_WORKSPACE_TARGET);
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) session.connection.close();
    this.sessions.clear();
    await stopManagedOpenCodeServer();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
