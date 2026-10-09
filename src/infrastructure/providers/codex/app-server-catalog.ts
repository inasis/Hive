import type { AssistantModel } from "../../../domain/assistant.js";
import { asObject, firstString, parseCodexThread, type CodexThread } from "./thread-parser.js";

type JsonObject = Record<string, unknown>;
type CatalogMethod = "thread/list" | "model/list";
type CatalogRequest = (method: CatalogMethod, params: JsonObject, timeoutMs?: number) => Promise<unknown>;

/** Maps and pages the Codex app-server thread and model catalog endpoints. */
export class CodexAppServerCatalog {
  constructor(private readonly request: CatalogRequest) {}

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
      const response = await this.request("thread/list", {
        limit: Math.min(100, options.limit - threads.size),
        sortKey: "updated_at",
        archived: false,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(cursor ? { cursor } : {}),
      }, remainingMs);
      const record = asObject(response);
      const rows = Array.isArray(record?.data) ? record.data : [];
      for (const row of rows) {
        const thread = parseCodexThread(row);
        if (thread) threads.set(thread.id, thread);
      }

      const nextCursor = firstString(record?.nextCursor);
      if (!nextCursor || cursors.has(nextCursor)) break;
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    return [...threads.values()].slice(0, options.limit);
  }

  async listModels(): Promise<AssistantModel[]> {
    const models = new Map<string, AssistantModel>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    while (models.size < 500) {
      const response = await this.request("model/list", {
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
}
