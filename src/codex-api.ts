import { CodexRpcConnection } from "./codex-rpc.js";
import type { AssistantModel } from "./domain/assistant.js";

type JsonObject = Record<string, unknown>;

export type CodexThread = JsonObject & {
  id?: string;
  cwd?: string;
  title?: string;
  name?: string;
  preview?: string;
  updatedAt?: string | number;
};

export type CodexModel = AssistantModel;

type CodexAppServerMethod =
  | "thread/list"
  | "thread/read"
  | "thread/turns/list"
  | "model/list"
  | "skills/list"
  | "thread/name/set"
  | "thread/delete"
  | "thread/start"
  | "thread/resume"
  | "thread/fork"
  | "collaborationMode/list"
  | "thread/goal/get"
  | "thread/goal/clear"
  | "thread/goal/set"
  | "thread/settings/update"
  | "turn/start"
  | "turn/steer"
  | "turn/interrupt";

/** Domain-level API for Codex app-server, separate from its JSON-RPC transport. */
export class CodexAppServerApi {
  private constructor(private readonly rpc: CodexRpcConnection) {}

  static async connect(target: string): Promise<CodexAppServerApi> {
    return new CodexAppServerApi(await CodexRpcConnection.connect(target));
  }

  onNotification(listener: Parameters<CodexRpcConnection["onNotification"]>[0]): () => void {
    return this.rpc.onNotification(listener);
  }

  respondToRequest(requestId: number | string, result: JsonObject): void {
    this.rpc.respond(requestId, result);
  }

  respondWithError(requestId: number | string, code: number, message: string): void {
    this.rpc.respondError(requestId, code, message);
  }

  close(): Promise<void> {
    return this.rpc.close();
  }

  async listThreads(options: { cwd?: string; limit: number; timeoutMs?: number }): Promise<CodexThread[]> {
    const threads = new Map<string, CodexThread>();
    const cursors = new Set<string>();
    const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;
    let cursor: string | undefined;

    while (threads.size < options.limit) {
      const remainingMs = deadline === undefined ? undefined : deadline - Date.now();
      if (remainingMs !== undefined && remainingMs <= 0) {
        throw new Error("Timed out while listing Codex sessions");
      }
      const response = await this.call<unknown>("thread/list", {
        limit: Math.min(100, options.limit - threads.size),
        sortKey: "updated_at",
        archived: false,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(cursor ? { cursor } : {}),
      }, remainingMs);
      const record = asObject(response);
      const rows = Array.isArray(record?.data) ? record.data : [];
      for (const row of rows) {
        const thread = asObject(row) as CodexThread | undefined;
        const id = firstString(thread?.id);
        if (thread && id) threads.set(id, thread);
      }

      const nextCursor = firstString(record?.nextCursor);
      if (!nextCursor || cursors.has(nextCursor)) break;
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    return [...threads.values()].slice(0, options.limit);
  }

  async readThread(threadId: string): Promise<JsonObject> {
    const metadata = asObject(await this.readThreadMetadata(threadId));
    const thread = asObject(metadata?.thread);
    if (!metadata || !thread) throw new Error("Codex returned an invalid thread/read response");

    if (thread.historyMode === "paginated") {
      const turns = await this.readPaginatedTurns(threadId);
      return { ...metadata, thread: { ...thread, turns } };
    }

    const completeResponse = await this.call<unknown>("thread/read", { threadId, includeTurns: true });
    const complete = asObject(completeResponse);
    if (!complete || !asObject(complete.thread)) {
      throw new Error("Codex returned an invalid full-history response");
    }
    return complete;
  }

  readThreadMetadata(threadId: string): Promise<unknown> {
    return this.call("thread/read", { threadId, includeTurns: false });
  }

  async listModels(): Promise<CodexModel[]> {
    const models = new Map<string, CodexModel>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    while (models.size < 500) {
      const response = await this.call<unknown>("model/list", {
        limit: 100,
        includeHidden: true,
        ...(cursor ? { cursor } : {}),
      });
      const record = asObject(response);
      const rows = Array.isArray(record?.data) ? record.data : [];
      for (const rowValue of rows) {
        const row = asObject(rowValue);
        const model = firstString(row?.model);
        if (!row || !model) continue;
        const efforts = Array.isArray(row.supportedReasoningEfforts) ? row.supportedReasoningEfforts : [];
        models.set(model, {
          model,
          displayName: firstString(row.displayName) ?? model,
          description: firstString(row.description) ?? "",
          defaultReasoningEffort: firstString(row.defaultReasoningEffort) ?? "",
          supportedReasoningEfforts: efforts.flatMap((effortValue) => {
            const effort = asObject(effortValue);
            const reasoningEffort = firstString(effort?.reasoningEffort);
            return reasoningEffort ? [{ reasoningEffort, description: firstString(effort?.description) ?? "" }] : [];
          }),
          isDefault: row.isDefault === true,
          hidden: row.hidden === true,
        });
      }
      const nextCursor = firstString(record?.nextCursor);
      if (!nextCursor || cursors.has(nextCursor)) break;
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    return [...models.values()];
  }

  listSkills(cwd?: string): Promise<unknown> {
    return this.call("skills/list", { cwds: cwd ? [cwd] : [], forceReload: true }, 60_000);
  }

  setThreadName(threadId: string, name: string): Promise<unknown> {
    return this.call("thread/name/set", { threadId, name });
  }

  deleteThread(threadId: string, timeoutMs = 20_000): Promise<unknown> {
    return this.call("thread/delete", { threadId }, timeoutMs);
  }

  startThread(cwd: string): Promise<unknown> {
    return this.call("thread/start", { cwd });
  }

  resumeThread(threadId: string, options: { excludeTurns: boolean }): Promise<unknown> {
    return this.call("thread/resume", { threadId, ...options });
  }

  forkThread(threadId: string, options: { ephemeral: boolean; excludeTurns?: boolean; lastTurnId?: string }): Promise<unknown> {
    return this.call("thread/fork", { threadId, ...options });
  }

  listCollaborationModes(): Promise<unknown> {
    return this.call("collaborationMode/list", {});
  }

  getThreadGoal(threadId: string): Promise<unknown> {
    return this.call("thread/goal/get", { threadId });
  }

  clearThreadGoal(threadId: string): Promise<unknown> {
    return this.call("thread/goal/clear", { threadId });
  }

  setThreadGoal(threadId: string, update: { status: string } | { objective: string }): Promise<unknown> {
    return this.call("thread/goal/set", { threadId, ...update });
  }

  updateThreadSettings(threadId: string, settings: JsonObject): Promise<unknown> {
    return this.call("thread/settings/update", { threadId, ...settings });
  }

  startTurn(threadId: string, text: string): Promise<unknown> {
    return this.call("turn/start", { threadId, input: [{ type: "text", text }] });
  }

  steerTurn(threadId: string, expectedTurnId: string, text: string): Promise<unknown> {
    return this.call("turn/steer", { threadId, expectedTurnId, input: [{ type: "text", text }] });
  }

  interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.call("turn/interrupt", { threadId, turnId });
  }

  private async readPaginatedTurns(threadId: string): Promise<JsonObject[]> {
    const turns = new Map<string, JsonObject>();
    const cursors = new Set<string>();
    let cursor: string | undefined;

    while (true) {
      const response = await this.call<unknown>("thread/turns/list", {
        threadId,
        limit: 100,
        sortDirection: "asc",
        itemsView: "full",
        ...(cursor ? { cursor } : {}),
      });
      const record = asObject(response);
      const rows = Array.isArray(record?.data) ? record.data : [];
      for (const row of rows) {
        const turn = asObject(row);
        const id = firstString(turn?.id);
        if (turn && id) turns.set(id, turn);
      }

      const nextCursor = firstString(record?.nextCursor);
      if (!nextCursor || cursors.has(nextCursor)) break;
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    return [...turns.values()];
  }

  private call<T = unknown>(method: CodexAppServerMethod, params: JsonObject, timeoutMs?: number): Promise<T> {
    return this.rpc.request<T>(method, params, timeoutMs);
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
