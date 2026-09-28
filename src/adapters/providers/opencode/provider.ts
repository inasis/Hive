import { openCodeAuthorization, probeOpenCodeApi, type OpenCodeApiVersion } from "./api.js";
import { parseOpenCodeModelId, type OpenCodeModel } from "./model-mapper.js";
import {
  mapOpenCodeSession,
  mapOpenCodeTranscript,
  normalizeV2Message,
  openCodeModelFromMessages,
  openCodeModelFromSession,
  parseOpenCodeMessage,
  parseOpenCodeSession,
  type OpenCodeMessage,
  type OpenCodeSessionInfo,
} from "./conversation-mapper.js";
import { OpenCodeTurnWatcher } from "./turn-watcher.js";
import { OpenCodeHttpClient } from "./http-client.js";
import { loadOpenCodeModelCatalog } from "./model-catalog.js";
import { parseOpenCodeCommands, parseOpenCodeSkills } from "./resource-catalog-mapper.js";
import type { OpenCodeCommand, OpenCodeSkill } from "./types.js";
import type { AssistantEvent } from "../../../application/ports/events.js";

type JsonObject = Record<string, unknown>;
const OPENCODE_MESSAGE_LIMIT = 200;

/** Adapter for OpenCode's documented HTTP server API. Credentials stay in memory. */
export class OpenCodeProviderConnection {
  readonly baseUrl: URL;
  readonly models: OpenCodeModel[];
  readonly modelWarning: string | undefined;
  private readonly http: OpenCodeHttpClient;
  private readonly apiVersion: OpenCodeApiVersion;
  private readonly turnWatcher: OpenCodeTurnWatcher;
  private readonly pendingPrompts = new Set<string>();
  private closed = false;

  private constructor(http: OpenCodeHttpClient, apiVersion: OpenCodeApiVersion, models: OpenCodeModel[], modelWarning?: string) {
    this.baseUrl = http.baseUrl;
    this.http = http;
    this.apiVersion = apiVersion;
    this.models = models;
    this.modelWarning = modelWarning;
    this.turnWatcher = new OpenCodeTurnWatcher(
      apiVersion,
      (sessionId, signal) => this.listMessages(sessionId, false, signal),
      (signal) => this.http.request("/session/status", undefined, { signal }),
    );
  }

  static async connect(
    endpoint: string,
    username: string,
    password: string,
  ): Promise<OpenCodeProviderConnection> {
    let baseUrl: URL;
    try {
      baseUrl = new URL(endpoint.trim());
    } catch {
      throw new Error("OpenCode 서버 주소는 http:// 또는 https:// URL이어야 합니다.");
    }
    if (!(["http:", "https:"].includes(baseUrl.protocol)) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new Error("OpenCode 서버 주소에는 http(s):// 호스트와 선택적 경로만 입력하세요.");
    }
    baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");

    const user = username.trim() || "opencode";
    const authorization = openCodeAuthorization(user, password);
    const probe = await probeOpenCodeApi(baseUrl.toString().replace(/\/$/, ""), authorization);
    if (!probe.version) {
      if (probe.unauthorized) throw new Error("OpenCode 서버가 Basic 인증을 거부했습니다. 사용자 이름과 비밀번호를 확인하세요.");
      throw new Error(`OpenCode 서버 상태 확인에 실패했습니다: ${probe.lastStatus}`);
    }
    const http = new OpenCodeHttpClient(baseUrl, authorization);
    const provisional = new OpenCodeProviderConnection(http, probe.version, []);
    const modelDirectory = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || process.cwd();
    const catalog = await provisional.listModels(modelDirectory);
    return new OpenCodeProviderConnection(http, probe.version, catalog.models, catalog.modelWarning);
  }

  async listModels(directory?: string): Promise<{ models: OpenCodeModel[]; modelWarning?: string }> {
    return loadOpenCodeModelCatalog(this.http, this.apiVersion, directory);
  }

  async listSessions(directory?: string): Promise<OpenCodeSessionInfo[]> {
    const value = await this.http.request(this.apiVersion === "v2" ? "/api/session" : "/session", directory ? { directory } : undefined);
    const rows = this.apiVersion === "v2" ? dataArray(value) : value;
    return Array.isArray(rows) ? rows.flatMap((item) => {
      const session = parseOpenCodeSession(item);
      return session ? [session] : [];
    }) : [];
  }

  async getSession(sessionId: string, signal?: AbortSignal): Promise<OpenCodeSessionInfo> {
    const value = await this.http.request(
      `${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}`,
      undefined,
      signal ? { signal } : {},
    );
    const session = parseOpenCodeSession(this.apiVersion === "v2" ? unwrapData(value) : value);
    if (!session) throw new Error("OpenCode returned an invalid session response.");
    return session;
  }

  async createSession(directory: string, title?: string, model?: string): Promise<OpenCodeSessionInfo> {
    const path = this.apiVersion === "v2" ? "/api/session" : "/session";
    const query = this.apiVersion === "v2" ? undefined : { directory };
    const selectedModel = model ? parseOpenCodeModelId(model) : undefined;
    if (model && !selectedModel) throw new Error("Select a valid OpenCode model before creating a session.");
    const body = this.apiVersion === "v2"
      ? {
        ...(title ? { title } : {}),
        ...(selectedModel ? { model: { id: selectedModel.modelID, providerID: selectedModel.providerID } } : {}),
        location: { directory },
      }
      : (title ? { title } : {});
    const value = await this.http.request(path, query, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const session = parseOpenCodeSession(this.apiVersion === "v2" ? unwrapData(value) : value);
    if (!session) throw new Error("OpenCode returned an invalid session response.");
    return session;
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.http.request(
      `${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}${this.apiVersion === "v2" ? "/rename" : ""}`,
      undefined,
      {
      method: this.apiVersion === "v2" ? "POST" : "PATCH",
      body: JSON.stringify({ title }),
      },
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const watch = this.turnWatcher.stop(sessionId);
    try {
      const result = await this.http.request(
        `${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}`,
        undefined,
        { method: "DELETE" },
      );
      if (unwrapData(result) === false) throw new Error("OpenCode reported that the session was not deleted.");
      this.pendingPrompts.delete(sessionId);
    } catch (error) {
      if (await this.isSessionMissing(sessionId)) {
        this.pendingPrompts.delete(sessionId);
        return;
      }
      if (watch) this.turnWatcher.resume(sessionId, watch);
      throw error;
    }
  }

  private async isSessionMissing(sessionId: string): Promise<boolean> {
    try {
      await this.getSession(sessionId, AbortSignal.timeout(5_000));
      return false;
    } catch (error) {
      return errorMessage(error).includes("OpenCode 서버 응답 오류 404");
    }
  }

  async forkSession(sessionId: string, throughMessageId?: string): Promise<OpenCodeSessionInfo> {
    let boundaryMessageId: string | undefined;
    if (throughMessageId) {
      const messages = await this.listMessages(sessionId);
      const messageIndex = messages.findIndex((message) => message.info?.id === throughMessageId);
      if (messageIndex < 0) throw new Error("OpenCode could not find the selected message in this session.");
      // OpenCode copies messages before messageID, so use the following message
      // as the exclusive boundary to include the selected response.
      boundaryMessageId = messages[messageIndex + 1]?.info?.id;
    }
    const value = await this.http.request(`${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}/fork`, undefined, {
      method: "POST",
      body: JSON.stringify(boundaryMessageId ? { messageID: boundaryMessageId } : {}),
    });
    const session = parseOpenCodeSession(this.apiVersion === "v2" ? unwrapData(value) : value);
    if (!session) throw new Error("OpenCode returned an invalid fork response.");
    return session;
  }

  async listMessages(sessionId: string, allPages = true, signal?: AbortSignal): Promise<OpenCodeMessage[]> {
    const route = this.apiVersion === "v2" ? "/api/session" : "/session";
    const sessionRoute = `${route}/${encodeURIComponent(sessionId)}/message`;
    if (this.apiVersion === "v1") {
      const rows = await this.http.request(`${sessionRoute}?limit=${OPENCODE_MESSAGE_LIMIT}`, undefined, signal ? { signal } : {});
      return Array.isArray(rows) ? rows.flatMap((item) => {
        const message = parseOpenCodeMessage(item);
        return message ? [message] : [];
      }) : [];
    }

    const messages: JsonObject[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: String(OPENCODE_MESSAGE_LIMIT) });
      // OpenCode v2 cursors already encode the order and reject an explicit order alongside them.
      if (!cursor) query.set("order", allPages ? "asc" : "desc");
      if (cursor) query.set("cursor", cursor);
      const value = await this.http.request(`${sessionRoute}?${query}`, undefined, signal ? { signal } : {});
      messages.push(...dataArray(value).map(asObject).filter((item): item is JsonObject => Boolean(item)));
      const nextCursor = allPages ? firstString(asObject(asObject(value)?.cursor)?.next) : undefined;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (allPages);

    const orderedMessages = allPages ? messages : messages.reverse();
    return orderedMessages.map(normalizeV2Message);
  }

  async listSkills(directory?: string): Promise<OpenCodeSkill[]> {
    const value = await this.http.request(
      this.apiVersion === "v2" ? "/api/skill" : "/skill",
      directory ? (this.apiVersion === "v2" ? { locationDirectory: directory } : { directory }) : undefined,
    );
    return parseOpenCodeSkills(value, this.apiVersion);
  }

  async listCommands(directory?: string): Promise<OpenCodeCommand[]> {
    const value = await this.http.request(
      this.apiVersion === "v2" ? "/api/command" : "/command",
      directory ? (this.apiVersion === "v2" ? { locationDirectory: directory } : { directory }) : undefined,
    );
    return parseOpenCodeCommands(value, this.apiVersion);
  }

  async setSessionModel(sessionId: string, model: string): Promise<void> {
    const selectedModel = parseOpenCodeModelId(model);
    if (!selectedModel) throw new Error("Select a valid OpenCode model before sending a message.");
    if (this.apiVersion === "v2") {
      await this.http.request(`/api/session/${encodeURIComponent(sessionId)}/model`, undefined, {
        method: "POST",
        body: JSON.stringify({ model: { id: selectedModel.modelID, providerID: selectedModel.providerID } }),
      });
    }
  }

  async sendPrompt(
    target: string,
    sessionId: string,
    text: string,
    model: string,
    publish: (event: AssistantEvent) => void,
    command?: { name: string; arguments: string },
  ): Promise<string> {
    if (this.closed) throw new Error("OpenCode connection is closed.");
    if (this.turnWatcher.isWatching(sessionId) || this.pendingPrompts.has(sessionId)) throw new Error("OpenCode is already generating a response in this session.");
    this.pendingPrompts.add(sessionId);
    const turnId = `opencode-${crypto.randomUUID()}`;
    const selectedModel = parseOpenCodeModelId(model);
    try {
      if (!selectedModel) throw new Error("OpenCode 세션에 모델이 선택되지 않았습니다. 모델을 선택한 뒤 메시지를 보내세요.");
      const messages = await this.listMessages(sessionId, false);
      const baseline = new Set(messages.map((message) => message.info?.id).filter((id): id is string => typeof id === "string"));
      if (this.apiVersion === "v2") {
        if (selectedModel) await this.setSessionModel(sessionId, model);
        await this.http.request(`/api/session/${encodeURIComponent(sessionId)}/${command ? "command" : "prompt"}`, undefined, {
          method: "POST",
          body: JSON.stringify(command ? { command: command.name, arguments: command.arguments } : { text }),
        });
      } else {
        await this.http.request(`/session/${encodeURIComponent(sessionId)}/${command ? "command" : "prompt_async"}`, undefined, {
          method: "POST",
          body: JSON.stringify(command ? { command: command.name, arguments: command.arguments } : {
            parts: [{ type: "text", text }],
            ...(selectedModel ? { model: selectedModel } : {}),
          }),
        });
      }
      this.turnWatcher.start(target, sessionId, turnId, baseline, publish);
      return turnId;
    } catch (error) {
      throw error;
    } finally {
      this.pendingPrompts.delete(sessionId);
    }
  }

  async abortSession(
    target: string,
    sessionId: string,
    publish: (event: AssistantEvent) => void,
  ): Promise<void> {
    await this.http.request(`${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}/${this.apiVersion === "v2" ? "interrupt" : "abort"}`, undefined, { method: "POST" });
    const watch = this.turnWatcher.stop(sessionId);
    if (watch) {
      publish({ target, threadId: sessionId, provider: "opencode", type: "turnCompleted", turnId: watch.turnId, status: "interrupted" });
    }
  }

  close(): void {
    this.closed = true;
    this.turnWatcher.close();
  }

}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function unwrapData(value: unknown): unknown {
  const record = asObject(value);
  return record && "data" in record ? record.data : value;
}

function dataArray(value: unknown): unknown[] {
  const data = asObject(value)?.data;
  return Array.isArray(data) ? data : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
