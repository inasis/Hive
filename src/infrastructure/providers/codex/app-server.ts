import { CodexRpcConnection } from "../../transport/codex-rpc.js";
import { connectCodexProcessTransport } from "../../transport/codex-process-transport.js";
import { CodexAppServerCatalog } from "./app-server-catalog.js";
import { CodexThreadHistory } from "./thread-history.js";
import type { CodexThread } from "./thread-parser.js";
import type { AssistantModel } from "../../../domain/assistant.js";
import type { PromptImageAttachment } from "../../../domain/prompt-attachments.js";

export type { CodexThread } from "./thread-parser.js";

type JsonObject = Record<string, unknown>;

export type CodexModel = AssistantModel;

type CodexTurnInput = { type: "text"; text: string } | { type: "image"; url: string };

type CodexAppServerMethod =
  | "initialize"
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
  private readonly threadHistory: CodexThreadHistory;
  private readonly catalog: CodexAppServerCatalog;

  private constructor(private readonly rpc: CodexRpcConnection) {
    this.threadHistory = new CodexThreadHistory((method, params) => this.call(method, params));
    this.catalog = new CodexAppServerCatalog((method, params, timeoutMs) => this.call(method, params, timeoutMs));
  }

  static async connect(target: string): Promise<CodexAppServerApi> {
    const connection = new CodexRpcConnection(await connectCodexProcessTransport(target));
    const api = new CodexAppServerApi(connection);
    try {
      await api.call("initialize", {
        clientInfo: {
          name: "hive-codex-bridge",
          title: "Hive Codex Session Bridge",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      });
      connection.notify("initialized", {});
      return api;
    } catch (error) {
      await connection.close();
      throw error;
    }
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
    return this.catalog.listThreads(options);
  }

  readThread(threadId: string): Promise<JsonObject> {
    return this.threadHistory.read(threadId);
  }

  readThreadMetadata(threadId: string): Promise<unknown> {
    return this.threadHistory.readMetadata(threadId);
  }

  async listModels(): Promise<CodexModel[]> {
    return this.catalog.listModels();
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

  startThread(cwd: string, options: { ephemeral?: boolean } = {}): Promise<unknown> {
    return this.call("thread/start", { cwd, ...(options.ephemeral ? { ephemeral: true } : {}) });
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

  startTurn(threadId: string, text: string, images: PromptImageAttachment[] = []): Promise<unknown> {
    const input: CodexTurnInput[] = [
      ...(text.trim() ? [{ type: "text" as const, text }] : []),
      ...images.map((image) => ({ type: "image" as const, url: `data:${image.mimeType};base64,${image.data}` })),
    ];
    return this.call("turn/start", { threadId, input });
  }

  steerTurn(threadId: string, expectedTurnId: string, text: string): Promise<unknown> {
    return this.call("turn/steer", { threadId, expectedTurnId, input: [{ type: "text", text }] });
  }

  interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.call("turn/interrupt", { threadId, turnId });
  }

  private call(method: CodexAppServerMethod, params: JsonObject, timeoutMs?: number): Promise<unknown> {
    return this.rpc.request(method, params, timeoutMs);
  }
}
