import { openCodeAuthorization, probeOpenCodeApi, type OpenCodeApiVersion } from "./opencode-api.js";
import type { AssistantModel } from "./domain/assistant.js";

export type OpenCodeModel = AssistantModel;

export type OpenCodeSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  content: string;
  enabled: boolean;
};

export type OpenCodeCommand = {
  name: string;
  description: string;
};

export type OpenCodeSessionInfo = {
  id: string;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
  location?: { directory?: string };
  [key: string]: unknown;
};

export type OpenCodeMessage = {
  info?: { id?: string; role?: string; type?: string; outcome?: string; time?: { created?: number; completed?: number }; [key: string]: unknown };
  parts?: unknown[];
};

export type OpenCodeBridgeEvent = {
  target: string;
  threadId: string;
  method: string;
  params: unknown;
};

type JsonObject = Record<string, unknown>;
const OPENCODE_MESSAGE_LIMIT = 200;
type ActiveWatch = {
  target: string;
  turnId: string;
  baseline: Set<string>;
  emittedByMessage: Map<string, string>;
  publish: (event: OpenCodeBridgeEvent) => void;
  timer: ReturnType<typeof setInterval>;
  polling: boolean;
  pollController?: AbortController;
};

/** Adapter for OpenCode's documented HTTP server API. Credentials stay in memory. */
export class OpenCodeProviderConnection {
  readonly baseUrl: URL;
  readonly models: OpenCodeModel[];
  readonly modelWarning: string | undefined;
  private readonly authorization: string | undefined;
  private readonly apiVersion: OpenCodeApiVersion;
  private readonly watches = new Map<string, ActiveWatch>();
  private readonly pendingPrompts = new Set<string>();
  private closed = false;

  private constructor(baseUrl: URL, authorization: string | undefined, apiVersion: OpenCodeApiVersion, models: OpenCodeModel[], modelWarning?: string) {
    this.baseUrl = baseUrl;
    this.authorization = authorization;
    this.apiVersion = apiVersion;
    this.models = models;
    this.modelWarning = modelWarning;
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
    const provisional = new OpenCodeProviderConnection(baseUrl, authorization, probe.version, []);
    const modelDirectory = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || process.cwd();
    const catalog = await provisional.listModels(modelDirectory);
    return new OpenCodeProviderConnection(baseUrl, authorization, probe.version, catalog.models, catalog.modelWarning);
  }

  async listModels(directory?: string): Promise<{ models: OpenCodeModel[]; modelWarning?: string }> {
    const modelDirectory = directory?.trim();
    const modelQuery = modelDirectory
      ? this.apiVersion === "v2" ? { locationDirectory: modelDirectory } : { directory: modelDirectory }
      : undefined;
    const modelRequestInit: RequestInit = this.apiVersion === "v2" && modelDirectory
      ? { headers: { "x-opencode-directory": encodeURIComponent(modelDirectory) } }
      : {};
    const modelReadErrors: string[] = [];
    const readOptional = async (path: string): Promise<unknown | undefined> => {
      try {
        return await this.request<unknown>(path, modelQuery, modelRequestInit);
      } catch (error) {
        modelReadErrors.push(`${path}: ${errorMessage(error)}`);
        return undefined;
      }
    };
    const [modelResponse, defaultResponse] = await Promise.all([
      this.apiVersion === "v2"
        ? readOptional("/api/model")
        : readOptional("/config/providers"),
      this.apiVersion === "v2" ? readOptional("/api/model/default") : Promise.resolve(undefined),
    ]);
    const defaultModel = asObject(unwrapData(defaultResponse)) ?? undefined;
    let models = mapOpenCodeModels(asObject(unwrapData(modelResponse)) ?? {}, this.apiVersion, defaultModel);
    const modelSourceDetails = [`${this.apiVersion === "v2" ? "/api/model" : "/config/providers"}: ${models.filter((model) => !model.hidden).length}개`];
    if (this.apiVersion === "v2") {
      const configResponse = await readOptional("/api/config");
      if (configResponse !== undefined) {
        const configuredModels = mapOpenCodeConfiguredModels(configResponse, defaultModel);
        modelSourceDetails.push(`/api/config: ${configuredModels.filter((model) => !model.hidden).length}개`);
        models = mergeOpenCodeModels(models, configuredModels);
      }
    } else {
      const [configuredProviders, configResponse] = await Promise.all([
        readOptional("/config/providers"),
        readOptional("/config"),
      ]);
      if (configuredProviders) {
        const configuredProviderModels = mapOpenCodeModels(asObject(configuredProviders) ?? {}, "v1");
        modelSourceDetails.push(`/config/providers: ${configuredProviderModels.filter((model) => !model.hidden).length}개`);
        models = mergeOpenCodeModels(models, configuredProviderModels);
      }
      if (configResponse !== undefined) {
        const configuredModels = mapOpenCodeConfiguredModels(configResponse, defaultModel);
        modelSourceDetails.push(`/config: ${configuredModels.filter((model) => !model.hidden).length}개`);
        models = mergeOpenCodeModels(models, configuredModels);
      }
    }
    const modelWarning = models.some((model) => !model.hidden)
      ? undefined
      : `OpenCode ${this.apiVersion} API에서 선택 가능한 모델을 찾지 못했습니다. 가져온 모델 수: ${[...modelSourceDetails, ...modelReadErrors].join("; ") || "모델 목록과 설정 응답 없음"}`;
    return { models, ...(modelWarning ? { modelWarning } : {}) };
  }

  async listSessions(directory?: string): Promise<OpenCodeSessionInfo[]> {
    const value = await this.request<unknown>(this.apiVersion === "v2" ? "/api/session" : "/session", directory ? { directory } : undefined);
    const rows = this.apiVersion === "v2" ? dataArray(value) : value;
    return Array.isArray(rows) ? rows.map(asObject).filter((item): item is JsonObject => Boolean(item)) as OpenCodeSessionInfo[] : [];
  }

  async getSession(sessionId: string, signal?: AbortSignal): Promise<OpenCodeSessionInfo> {
    const value = await this.request<unknown>(
      `${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}`,
      undefined,
      signal ? { signal } : {},
    );
    return (this.apiVersion === "v2" ? unwrapData(value) : value) as OpenCodeSessionInfo;
  }

  async createSession(directory: string, title?: string, model?: string): Promise<OpenCodeSessionInfo> {
    const path = this.apiVersion === "v2" ? "/api/session" : "/session";
    const query = this.apiVersion === "v2" ? undefined : { directory };
    const selectedModel = model ? parseModel(model) : undefined;
    if (model && !selectedModel) throw new Error("Select a valid OpenCode model before creating a session.");
    const body = this.apiVersion === "v2"
      ? {
        ...(title ? { title } : {}),
        ...(selectedModel ? { model: { id: selectedModel.modelID, providerID: selectedModel.providerID } } : {}),
        location: { directory },
      }
      : (title ? { title } : {});
    const value = await this.request<unknown>(path, query, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const session = asObject(this.apiVersion === "v2" ? unwrapData(value) : value);
    if (!session || typeof session.id !== "string") throw new Error("OpenCode returned an invalid session response.");
    return session as OpenCodeSessionInfo;
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.request(
      `${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}${this.apiVersion === "v2" ? "/rename" : ""}`,
      undefined,
      {
      method: this.apiVersion === "v2" ? "POST" : "PATCH",
      body: JSON.stringify({ title }),
      },
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const watch = this.watches.get(sessionId);
    if (watch) this.stopWatch(sessionId);
    try {
      const result = await this.request<unknown>(
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
      if (watch) this.resumeWatch(sessionId, watch);
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
    const value = await this.request<unknown>(`${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}/fork`, undefined, {
      method: "POST",
      body: JSON.stringify(boundaryMessageId ? { messageID: boundaryMessageId } : {}),
    });
    const session = asObject(this.apiVersion === "v2" ? unwrapData(value) : value);
    if (!session || typeof session.id !== "string") throw new Error("OpenCode returned an invalid fork response.");
    return session as OpenCodeSessionInfo;
  }

  async listMessages(sessionId: string, allPages = true, signal?: AbortSignal): Promise<OpenCodeMessage[]> {
    const route = this.apiVersion === "v2" ? "/api/session" : "/session";
    const sessionRoute = `${route}/${encodeURIComponent(sessionId)}/message`;
    if (this.apiVersion === "v1") {
      const rows = await this.request<unknown>(`${sessionRoute}?limit=${OPENCODE_MESSAGE_LIMIT}`, undefined, signal ? { signal } : {});
      return Array.isArray(rows)
        ? rows.map(asObject).filter((item): item is JsonObject => Boolean(item)) as OpenCodeMessage[]
        : [];
    }

    const messages: JsonObject[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: String(OPENCODE_MESSAGE_LIMIT) });
      // OpenCode v2 cursors already encode the order and reject an explicit order alongside them.
      if (!cursor) query.set("order", allPages ? "asc" : "desc");
      if (cursor) query.set("cursor", cursor);
      const value = await this.request<unknown>(`${sessionRoute}?${query}`, undefined, signal ? { signal } : {});
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
    const value = await this.request<unknown>(
      this.apiVersion === "v2" ? "/api/skill" : "/skill",
      directory ? (this.apiVersion === "v2" ? { locationDirectory: directory } : { directory }) : undefined,
    );
    const record = asObject(value);
    const rows = this.apiVersion === "v2"
      ? dataArray(value)
      : Array.isArray(value) ? value : Array.isArray(record?.skills) ? record.skills : dataArray(value);
    return rows.flatMap((rowValue) => {
      if (typeof rowValue === "string" && rowValue.trim()) {
        return [{ id: rowValue, name: rowValue, description: "", path: "", content: "", enabled: true }];
      }
      const row = asObject(rowValue);
      const id = firstString(row?.id, row?.name);
      if (!row || !id || isSlashSkillDisabled(typeof row.content === "string" ? row.content : "")) return [];
      return [{
        id,
        name: firstString(row.name, id) ?? id,
        description: firstString(row.description) ?? "",
        path: firstString(row.path) ?? "",
        content: typeof row.content === "string" ? row.content : "",
        enabled: row.enabled !== false,
      }];
    });
  }

  async listCommands(directory?: string): Promise<OpenCodeCommand[]> {
    const value = await this.request<unknown>(
      this.apiVersion === "v2" ? "/api/command" : "/command",
      directory ? (this.apiVersion === "v2" ? { locationDirectory: directory } : { directory }) : undefined,
    );
    const record = asObject(value);
    const rows = this.apiVersion === "v2"
      ? dataArray(value)
      : Array.isArray(value) ? value : Array.isArray(record?.commands) ? record.commands : [];
    return rows.flatMap((rowValue) => {
      const row = asObject(rowValue);
      const name = firstString(row?.name);
      return row && name ? [{ name, description: firstString(row.description) ?? "" }] : [];
    });
  }

  async setSessionModel(sessionId: string, model: string): Promise<void> {
    const selectedModel = parseModel(model);
    if (!selectedModel) throw new Error("Select a valid OpenCode model before sending a message.");
    if (this.apiVersion === "v2") {
      await this.request(`/api/session/${encodeURIComponent(sessionId)}/model`, undefined, {
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
    publish: (event: OpenCodeBridgeEvent) => void,
    command?: { name: string; arguments: string },
  ): Promise<string> {
    if (this.closed) throw new Error("OpenCode connection is closed.");
    if (this.watches.has(sessionId) || this.pendingPrompts.has(sessionId)) throw new Error("OpenCode is already generating a response in this session.");
    this.pendingPrompts.add(sessionId);
    const turnId = `opencode-${crypto.randomUUID()}`;
    const selectedModel = parseModel(model);
    try {
      if (!selectedModel) throw new Error("OpenCode 세션에 모델이 선택되지 않았습니다. 모델을 선택한 뒤 메시지를 보내세요.");
      const messages = await this.listMessages(sessionId, false);
      const baseline = new Set(messages.map((message) => message.info?.id).filter((id): id is string => typeof id === "string"));
      if (this.apiVersion === "v2") {
        if (selectedModel) await this.setSessionModel(sessionId, model);
        await this.request(`/api/session/${encodeURIComponent(sessionId)}/${command ? "command" : "prompt"}`, undefined, {
          method: "POST",
          body: JSON.stringify(command ? { command: command.name, arguments: command.arguments } : { text }),
        });
      } else {
        await this.request(`/session/${encodeURIComponent(sessionId)}/${command ? "command" : "prompt_async"}`, undefined, {
          method: "POST",
          body: JSON.stringify(command ? { command: command.name, arguments: command.arguments } : {
            parts: [{ type: "text", text }],
            ...(selectedModel ? { model: selectedModel } : {}),
          }),
        });
      }
      const watch: ActiveWatch = {
        target,
        turnId,
        baseline,
        emittedByMessage: new Map(),
        publish,
        timer: setInterval(() => void this.pollSession(target, sessionId, publish), 700),
        polling: false,
      };
      this.watches.set(sessionId, watch);
      publish({ target, threadId: sessionId, method: "turn/started", params: { turn: { id: turnId } } });
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
    publish: (event: OpenCodeBridgeEvent) => void,
  ): Promise<void> {
    await this.request(`${this.apiVersion === "v2" ? "/api/session" : "/session"}/${encodeURIComponent(sessionId)}/${this.apiVersion === "v2" ? "interrupt" : "abort"}`, undefined, { method: "POST" });
    const watch = this.watches.get(sessionId);
    if (watch) {
      this.stopWatch(sessionId);
      publish({ target, threadId: sessionId, method: "turn/completed", params: { turn: { id: watch.turnId, status: "interrupted" } } });
    }
  }

  close(): void {
    this.closed = true;
    for (const sessionId of this.watches.keys()) this.stopWatch(sessionId);
  }

  private async pollSession(
    target: string,
    sessionId: string,
    publish: (event: OpenCodeBridgeEvent) => void,
  ): Promise<void> {
    const watch = this.watches.get(sessionId);
    if (!watch || watch.polling || this.closed) return;
    watch.polling = true;
    const pollController = new AbortController();
    watch.pollController = pollController;
    try {
      const [messages, statuses] = await Promise.all([
        this.listMessages(sessionId, false, pollController.signal),
        this.apiVersion === "v1"
          ? this.request<unknown>("/session/status", undefined, { signal: pollController.signal }).catch((error) => {
            if (pollController.signal.aborted) throw error;
            return {};
          })
          : Promise.resolve({}),
      ]);
      if (this.watches.get(sessionId) !== watch) return;
      const status = asObject(asObject(statuses)?.[sessionId]);
      const statusType = typeof status?.type === "string" ? status.type : "";
      const newAssistantMessages = messages.filter((message) =>
        message.info?.role === "assistant" && typeof message.info.id === "string" && !watch.baseline.has(message.info.id),
      );
      const idleMessage = this.apiVersion === "v2"
        ? [...messages].reverse().find((message) => message.info?.type === "idle" && typeof message.info.id === "string" && !watch.baseline.has(message.info.id))
        : undefined;
      for (const message of newAssistantMessages) {
        const messageId = message.info!.id as string;
        const text = openCodeMessageText(message);
        const previous = watch.emittedByMessage.get(messageId) ?? "";
        if (text.startsWith(previous) && text.length > previous.length) {
          publish({
            target,
            threadId: sessionId,
            method: "item/agentMessage/delta",
            params: { turnId: watch.turnId, itemId: messageId, delta: text.slice(previous.length) },
          });
          watch.emittedByMessage.set(messageId, text);
        } else if (text && text !== previous) {
          watch.emittedByMessage.set(messageId, text);
          publish({ target, threadId: sessionId, method: "item/agentMessage/delta", params: { turnId: watch.turnId, itemId: messageId, delta: text } });
        }
      }
      const hasResponse = newAssistantMessages.length > 0;
      const latestAssistant = newAssistantMessages.at(-1);
      const completedAt = latestAssistant?.info?.time?.completed;
      const done = this.apiVersion === "v2"
        ? Boolean(idleMessage)
        : hasResponse && (statusType === "idle" || (!statusType && typeof completedAt === "number" && completedAt > 0));
      if (!done) return;
      for (const message of newAssistantMessages) {
        const messageId = message.info?.id;
        if (typeof messageId !== "string") continue;
        const text = openCodeMessageText(message);
        publish({ target, threadId: sessionId, method: "item/completed", params: {
          turnId: watch.turnId,
          item: { id: messageId, type: "agentMessage", text },
        } });
      }
      this.stopWatch(sessionId);
      const outcome = idleMessage?.info?.outcome;
      const turnStatus = outcome === "interrupted" ? "interrupted" : outcome === "failed" ? "failed" : "completed";
      publish({ target, threadId: sessionId, method: "turn/completed", params: { turn: { id: watch.turnId, status: turnStatus } } });
    } catch (error) {
      if (!pollController.signal.aborted) {
        publish({ target, threadId: sessionId, method: "warning", params: { message: `OpenCode 상태를 가져오지 못했습니다: ${errorMessage(error)}` } });
      }
    } finally {
      if (watch.pollController === pollController) delete watch.pollController;
      watch.polling = false;
    }
  }

  private stopWatch(sessionId: string): void {
    const watch = this.watches.get(sessionId);
    if (!watch) return;
    clearInterval(watch.timer);
    watch.pollController?.abort();
    delete watch.pollController;
    this.watches.delete(sessionId);
  }

  private resumeWatch(sessionId: string, watch: ActiveWatch): void {
    if (this.closed) return;
    watch.timer = setInterval(() => void this.pollSession(watch.target, sessionId, watch.publish), 700);
    this.watches.set(sessionId, watch);
  }

  private async request<T = unknown>(
    path: string,
    query?: { directory?: string; locationDirectory?: string },
    init: RequestInit = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl.toString().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
    if (query?.directory) url.searchParams.set("directory", query.directory);
    if (query?.locationDirectory) url.searchParams.set("location[directory]", query.locationDirectory);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.authorization) headers.set("Authorization", this.authorization);
    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(30_000);
      const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      response = await fetch(url, { ...init, headers, signal });
    } catch (error) {
      throw new Error(openCodeFetchErrorMessage(error, url), { cause: error });
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 500);
      const reason = response.status === 401 ? " (Basic 인증의 사용자 이름 또는 비밀번호를 확인하세요)" : "";
      throw new Error(`OpenCode 서버 응답 오류 ${response.status}${reason}${detail ? `: ${detail}` : ""}`);
    }
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    if (!body.trim()) return undefined as T;
    try { return JSON.parse(body) as T; }
    catch { throw new Error("OpenCode 서버가 JSON이 아닌 응답을 반환했습니다."); }
  }
}

export function openCodeMessageText(message: OpenCodeMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.flatMap((partValue) => {
    const part = asObject(partValue);
    return part?.type === "text" && typeof part.text === "string" ? [part.text] : [];
  }).join("\n");
}

export function openCodeModelFromMessages(messages: OpenCodeMessage[]): string | undefined {
  const latest = [...messages].reverse().find((message) => message.info?.role === "assistant");
  const providerID = latest?.info?.providerID;
  const modelID = latest?.info?.modelID;
  return typeof providerID === "string" && typeof modelID === "string" ? `${providerID}/${modelID}` : undefined;
}

export function openCodeModelFromSession(session: OpenCodeSessionInfo): string | undefined {
  const model = asObject(session.model);
  const providerID = firstString(model?.providerID);
  const modelID = firstString(model?.id, model?.modelID);
  return providerID && modelID ? `${providerID}/${modelID}` : undefined;
}

export function defaultOpenCodeModel(models: OpenCodeModel[]): string | undefined {
  return models.find((model) => model.isDefault && !model.hidden)?.model ?? models.find((model) => !model.hidden)?.model;
}

export function mapOpenCodeModels(response: JsonObject, apiVersion: OpenCodeApiVersion = "v1", defaultModel?: JsonObject): OpenCodeModel[] {
  if (apiVersion === "v2") {
    const defaults = asObject(response.default) ?? defaultModel ?? {};
    const defaultProvider = firstString(defaults.providerID);
    const defaultId = firstString(defaults.id, defaults.modelID);
    const rows = [...dataArray(response)];
    if (defaultModel && defaultProvider && defaultId && !rows.some((value) => {
      const row = asObject(value);
      return firstString(row?.providerID) === defaultProvider && firstString(row?.id, row?.modelID) === defaultId;
    })) rows.push(defaultModel);
    return rows.flatMap((rowValue) => {
      const row = asObject(rowValue);
      const providerID = firstString(row?.providerID);
      const modelID = firstString(row?.id, row?.modelID);
      if (!row || !providerID || !modelID) return [];
      const key = `${providerID}/${modelID}`;
      return [{
        model: key,
        displayName: firstString(row.name) ?? key,
        description: firstString(asObject(row.compatibility)?.description) ?? "",
        defaultReasoningEffort: "",
        supportedReasoningEfforts: [],
        isDefault: defaultProvider === providerID && defaultId === modelID,
        hidden: row.enabled === false || row.status === "deprecated",
      }];
    }).sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
  }
  const providers = Array.isArray(response.providers) ? response.providers : [];
  const defaults = asObject(response.default) ?? {};
  const models: OpenCodeModel[] = [];
  for (const providerValue of providers) {
    const provider = asObject(providerValue);
    const providerId = provider?.id;
    const providerName = typeof provider?.name === "string" ? provider.name : providerId;
    const providerModels = asObject(provider?.models);
    if (typeof providerId !== "string" || !providerModels) continue;
    for (const [modelId, modelValue] of Object.entries(providerModels)) {
      const model = asObject(modelValue);
      if (!model) continue;
      const key = `${providerId}/${modelId}`;
      models.push({
        model: key,
        displayName: typeof model.name === "string" ? `${providerName} · ${model.name}` : key,
        description: typeof model.description === "string" ? model.description : "",
        defaultReasoningEffort: "",
        supportedReasoningEfforts: [],
        isDefault: defaults[providerId] === modelId || defaults[providerId] === key,
        hidden: model.status === "deprecated" || model.status === "disabled",
      });
    }
  }
  return models.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
}

export function mapOpenCodeConfiguredModels(response: unknown, defaultModel?: JsonObject): OpenCodeModel[] {
  const configDocuments = getOpenCodeConfigDocuments(response);
  const config = mergeOpenCodeConfigDocuments(configDocuments);
  const providers = asObject(config.providers) ?? asObject(config.provider) ?? {};
  const configModel = asObject(config.model);
  const configuredDefault = typeof config.model === "string" ? parseModel(config.model) : undefined;
  const defaultProvider = firstString(defaultModel?.providerID, configModel?.providerID, configuredDefault?.providerID);
  const defaultId = firstString(defaultModel?.id, defaultModel?.modelID, configModel?.model, configModel?.id, configuredDefault?.modelID);
  const models: OpenCodeModel[] = [];
  for (const [providerID, providerValue] of Object.entries(providers)) {
    const provider = asObject(providerValue);
    const providerModels = asObject(provider?.models);
    if (!provider || !providerModels || provider.disabled === true) continue;
    for (const [modelID, modelValue] of Object.entries(providerModels)) {
      const model = asObject(modelValue);
      if (!model) continue;
      const key = `${providerID}/${modelID}`;
      models.push({
        model: key,
        displayName: firstString(model.name) ? `${firstString(provider.name, providerID)} · ${firstString(model.name)}` : key,
        description: firstString(model.description) ?? "",
        defaultReasoningEffort: "",
        supportedReasoningEfforts: [],
        isDefault: defaultProvider === providerID && defaultId === modelID,
        hidden: model.enabled === false || model.disabled === true || model.status === "deprecated" || model.status === "disabled",
      });
    }
  }
  return models.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
}

function getOpenCodeConfigDocuments(response: unknown): JsonObject[] {
  const value = unwrapData(response);
  if (Array.isArray(value)) {
    return value.flatMap((entryValue) => {
      const entry = asObject(entryValue);
      const info = entry?.type === "document" ? asObject(entry.info) : undefined;
      return info ? [info] : [];
    });
  }
  const config = asObject(value);
  if (!config) return [];
  for (let depth = 0; depth < 3; depth += 1) {
    const nested = asObject(config.config);
    if (!nested) break;
    return getOpenCodeConfigDocuments(nested);
  }
  return [config];
}

function mergeOpenCodeConfigDocuments(documents: JsonObject[]): JsonObject {
  const merged: JsonObject = {};
  const providers: JsonObject = {};
  for (const document of documents) {
    for (const [key, value] of Object.entries(document)) {
      if (key !== "providers" && key !== "provider") {
        merged[key] = value;
        continue;
      }
      const providerEntries = asObject(value);
      if (!providerEntries) continue;
      for (const [providerID, providerValue] of Object.entries(providerEntries)) {
        const nextProvider = asObject(providerValue);
        if (!nextProvider) continue;
        const currentProvider = asObject(providers[providerID]) ?? {};
        providers[providerID] = {
          ...currentProvider,
          ...nextProvider,
          models: {
            ...(asObject(currentProvider.models) ?? {}),
            ...(asObject(nextProvider.models) ?? {}),
          },
        };
      }
    }
  }
  if (Object.keys(providers).length > 0) merged.providers = providers;
  return merged;
}

function mergeOpenCodeModels(primary: OpenCodeModel[], fallback: OpenCodeModel[]): OpenCodeModel[] {
  const models = new Map(primary.map((model) => [model.model, model]));
  for (const model of fallback) {
    const current = models.get(model.model);
    models.set(model.model, current ? { ...current, isDefault: current.isDefault || model.isDefault } : model);
  }
  return [...models.values()].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
}

export function mapOpenCodeSession(session: OpenCodeSessionInfo): {
  id: string;
  title: string;
  cwd: string;
  preview: string;
  updatedAt: number | null;
} {
  return {
    id: session.id,
    title: typeof session.title === "string" && session.title.trim() ? session.title : "새 세션",
    cwd: typeof session.directory === "string" ? session.directory : typeof session.location?.directory === "string" ? session.location.directory : "",
    preview: "",
    updatedAt: typeof session.time?.updated === "number" ? session.time.updated : null,
  };
}

export function mapOpenCodeTranscript(messages: OpenCodeMessage[]): {
  id: string;
  role: "user" | "assistant" | "tool" | "change";
  text: string;
  turnId?: string;
  providerMessageId?: string;
  responseCompleted?: boolean;
  toolType?: "commandExecution" | "mcpToolCall" | "webSearch";
  command?: string;
  output?: string;
  status?: string;
}[] {
  const entries: ReturnType<typeof mapOpenCodeTranscript> = [];
  let currentTurnId = "";
  for (const [messageIndex, message] of messages.entries()) {
    const messageId = typeof message.info?.id === "string" ? message.info.id : `message-${messageIndex}`;
    if (message.info?.role === "user") currentTurnId = messageId;
    if (message.info?.role === "user" || message.info?.role === "assistant") {
      const text = openCodeMessageText(message);
      const turnId = message.info.role === "assistant" ? currentTurnId || messageId : undefined;
      const responseCompleted = message.info.role !== "assistant" ||
        (typeof message.info.time?.completed === "number" && message.info.time.completed > 0) || Boolean(message.info.finish);
      if (text) entries.push({ id: messageId, ...(turnId ? { turnId } : {}), providerMessageId: messageId, role: message.info.role, text, responseCompleted });
    }
    for (const [partIndex, partValue] of (Array.isArray(message.parts) ? message.parts : []).entries()) {
      const part = asObject(partValue);
      if (!part || part.type === "text" || part.type === "step-start" || part.type === "step-finish" || part.type === "reasoning") continue;
      if (part.type === "tool") {
        const state = asObject(part.state);
        const input = asObject(state?.input) ?? {};
        const output = asObject(state?.output) ?? {};
        entries.push({
          id: typeof part.id === "string" ? part.id : `${messageId}:tool-${partIndex}`,
          role: "tool",
          text: typeof part.tool === "string" ? part.tool : "Tool",
          toolType: "mcpToolCall",
          command: JSON.stringify(input),
          output: typeof output.value === "string" ? output.value : typeof state?.output === "string" ? state.output : "",
          status: typeof state?.status === "string" ? state.status : "completed",
        });
      }
    }
  }
  return entries;
}

function parseModel(value: string): { providerID: string; modelID: string } | undefined {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
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

function isSlashSkillDisabled(content: string): boolean {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? "";
  const slash = /^slash:\s*(?:["']?(false|true)["']?)\s*$/im.exec(frontmatter)?.[1];
  const metadataSlash = /^\s+opencode\/slash:\s*(?:["']?(false|true)["']?)\s*$/im.exec(frontmatter)?.[1];
  return slash?.toLowerCase() === "false" || metadataSlash?.toLowerCase() === "false";
}

function normalizeV2Message(value: JsonObject): OpenCodeMessage {
  const type = firstString(value.type) ?? "";
  const time = asObject(value.time) ?? {};
  const id = firstString(value.id);
  const messageTime = {
    ...(typeof time.created === "number" ? { created: time.created } : {}),
    ...(typeof time.completed === "number" ? { completed: time.completed } : {}),
  };
  if (type === "user") {
    return {
      info: { ...(id ? { id } : {}), role: "user", type, time: messageTime },
      parts: [{ type: "text", text: typeof value.text === "string" ? value.text : "" }],
    };
  }
  if (type === "assistant") {
    const model = asObject(value.model) ?? {};
    const content = Array.isArray(value.content) ? value.content : [];
    return {
      info: { ...(id ? { id } : {}), role: "assistant", type, time: messageTime, providerID: model.providerID, modelID: firstString(model.id, model.modelID), finish: value.finish },
      parts: content.flatMap((partValue): unknown[] => {
        const part = asObject(partValue);
        if (!part) return [];
        if (part.type === "text" || part.type === "reasoning") return [{ type: part.type, text: typeof part.text === "string" ? part.text : "" }];
        if (part.type === "tool") {
          const state = asObject(part.state) ?? {};
          const contentRows = Array.isArray(state.content) ? state.content : [];
          const outputText = contentRows.flatMap((rowValue) => {
            const row = asObject(rowValue);
            return row?.type === "text" && typeof row.text === "string" ? [row.text] : [];
          }).join("\n");
          return [{
            type: "tool",
            id: part.id,
            tool: part.name,
            state: { status: state.status, input: asObject(state.input) ?? {}, output: { value: outputText } },
          }];
        }
        return [];
      }),
    };
  }
  if (type === "idle") return { info: { ...(id ? { id } : {}), type, ...(typeof value.outcome === "string" ? { outcome: value.outcome } : {}), time: messageTime }, parts: [] };
  return { info: { ...(id ? { id } : {}), type, time: messageTime }, parts: [] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openCodeFetchErrorMessage(error: unknown, url: URL): string {
  const cause = error instanceof Error ? asObject(error.cause) : undefined;
  const code = typeof cause?.code === "string" ? cause.code : "";
  const detail = typeof cause?.message === "string" ? cause.message : "";
  const causeText = [code, detail].filter(Boolean).join(": ");

  if (code === "ECONNREFUSED") {
    return `OpenCode 연결이 거부되었습니다${causeText ? ` (${causeText})` : ""}. Hive host에서 ${url.origin}에 OpenCode 서버가 실행 중인지 확인하세요.`;
  }
  if (["ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"].includes(code)) {
    return `OpenCode host에 연결할 수 없습니다${causeText ? ` (${causeText})` : ""}. Hive host에서 ${url.origin}에 접근할 수 있는지와 HIVE_OPENCODE_URL 설정을 확인하세요.`;
  }

  const detailText = causeText || errorMessage(error);
  return `OpenCode 네트워크 요청에 실패했습니다 (${detailText}). Hive host에서 ${url.origin}/api/health 응답을 확인하세요.`;
}
