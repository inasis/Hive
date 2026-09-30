import { openCodeAuthorization, probeOpenCodeApi, type OpenCodeApiVersion } from "./api.js";
import { parseOpenCodeModelId, type OpenCodeModel } from "./model-mapper.js";
import {
  mapOpenCodeSession,
  mapOpenCodeTranscript,
  openCodeModelFromMessages,
  openCodeModelFromSession,
  type OpenCodeMessage,
  type OpenCodeSessionInfo,
} from "./conversation-mapper.js";
import { OpenCodeTurnWatcher } from "./turn-watcher.js";
import { OpenCodeHttpClient } from "./http-client.js";
import { loadOpenCodeModelCatalog } from "./model-catalog.js";
import { OpenCodeMessageApi } from "./message-api.js";
import { OpenCodeResourceApi } from "./resource-api.js";
import { OpenCodeSessionApi } from "./session-api.js";
import { OpenCodeTurnApi } from "./turn-api.js";
import type { OpenCodeCommand, OpenCodeSkill } from "./types.js";
import type { AssistantEvent } from "../../../application/ports/events.js";

/** Adapter for OpenCode's documented HTTP server API. Credentials stay in memory. */
export class OpenCodeProviderConnection {
  readonly baseUrl: URL;
  readonly models: OpenCodeModel[];
  readonly modelWarning: string | undefined;
  private readonly http: OpenCodeHttpClient;
  private readonly apiVersion: OpenCodeApiVersion;
  private readonly messages: OpenCodeMessageApi;
  private readonly resources: OpenCodeResourceApi;
  private readonly sessions: OpenCodeSessionApi;
  private readonly turnApi: OpenCodeTurnApi;
  private readonly turnWatcher: OpenCodeTurnWatcher;
  private readonly pendingPrompts = new Set<string>();
  private closed = false;

  private constructor(http: OpenCodeHttpClient, apiVersion: OpenCodeApiVersion, models: OpenCodeModel[], modelWarning?: string) {
    this.baseUrl = http.baseUrl;
    this.http = http;
    this.apiVersion = apiVersion;
    this.messages = new OpenCodeMessageApi(http, apiVersion);
    this.resources = new OpenCodeResourceApi(http, apiVersion);
    this.sessions = new OpenCodeSessionApi(http, apiVersion, this.messages);
    this.turnApi = new OpenCodeTurnApi(http, apiVersion, (sessionId, allPages) => this.listMessages(sessionId, allPages));
    this.models = models;
    this.modelWarning = modelWarning;
    this.turnWatcher = new OpenCodeTurnWatcher(
      apiVersion,
      (sessionId, signal) => this.listMessages(sessionId, false, signal),
      (signal) => this.turnApi.sessionStatuses(signal),
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
    return this.sessions.list(directory);
  }

  async getSession(sessionId: string, signal?: AbortSignal): Promise<OpenCodeSessionInfo> {
    return this.sessions.get(sessionId, signal);
  }

  async createSession(directory: string, title?: string, model?: string): Promise<OpenCodeSessionInfo> {
    return this.sessions.create(directory, title, model);
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.sessions.rename(sessionId, title);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const watch = this.turnWatcher.stop(sessionId);
    try {
      await this.sessions.delete(sessionId);
      this.pendingPrompts.delete(sessionId);
    } catch (error) {
      if (watch) this.turnWatcher.resume(sessionId, watch);
      throw error;
    }
  }

  async forkSession(sessionId: string, throughMessageId?: string): Promise<OpenCodeSessionInfo> {
    return this.sessions.fork(sessionId, throughMessageId);
  }

  async listMessages(sessionId: string, allPages = true, signal?: AbortSignal): Promise<OpenCodeMessage[]> {
    return this.messages.list(sessionId, allPages, signal);
  }

  async listSkills(directory?: string): Promise<OpenCodeSkill[]> {
    return this.resources.listSkills(directory);
  }

  async listCommands(directory?: string): Promise<OpenCodeCommand[]> {
    return this.resources.listCommands(directory);
  }

  async setSessionModel(sessionId: string, model: string): Promise<void> {
    await this.turnApi.setModel(sessionId, model);
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
    try {
      const baseline = await this.turnApi.submit(sessionId, text, model, command);
      this.turnWatcher.start(target, sessionId, turnId, baseline, publish);
      return turnId;
    } finally {
      this.pendingPrompts.delete(sessionId);
    }
  }

  async abortSession(
    target: string,
    sessionId: string,
    publish: (event: AssistantEvent) => void,
  ): Promise<void> {
    await this.turnApi.interrupt(sessionId);
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
