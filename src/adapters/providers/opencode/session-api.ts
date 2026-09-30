import type { OpenCodeApiVersion } from "./api.js";
import { parseOpenCodeModelId } from "./model-mapper.js";
import { parseOpenCodeSession, type OpenCodeSessionInfo } from "./conversation-mapper.js";
import type { OpenCodeHttpClient } from "./http-client.js";
import { OpenCodeMessageApi } from "./message-api.js";

type JsonObject = Record<string, unknown>;

/** OpenCode session CRUD over the versioned HTTP API. */
export class OpenCodeSessionApi {
  constructor(
    private readonly http: OpenCodeHttpClient,
    private readonly apiVersion: OpenCodeApiVersion,
    private readonly messages: OpenCodeMessageApi,
  ) {}

  async list(directory?: string): Promise<OpenCodeSessionInfo[]> {
    const value = await this.http.request(this.apiVersion === "v2" ? "/api/session" : "/session", directory ? { directory } : undefined);
    const rows = this.apiVersion === "v2" ? dataArray(value) : value;
    return Array.isArray(rows) ? rows.flatMap((item) => {
      const session = parseOpenCodeSession(item);
      return session ? [session] : [];
    }) : [];
  }

  async get(sessionId: string, signal?: AbortSignal): Promise<OpenCodeSessionInfo> {
    const value = await this.http.request(
      `${this.sessionRoute()}/${encodeURIComponent(sessionId)}`,
      undefined,
      signal ? { signal } : {},
    );
    const session = parseOpenCodeSession(this.apiVersion === "v2" ? unwrapData(value) : value);
    if (!session) throw new Error("OpenCode returned an invalid session response.");
    return session;
  }

  async create(directory: string, title?: string, model?: string): Promise<OpenCodeSessionInfo> {
    const selectedModel = model ? parseOpenCodeModelId(model) : undefined;
    if (model && !selectedModel) throw new Error("Select a valid OpenCode model before creating a session.");
    const body = this.apiVersion === "v2"
      ? {
        ...(title ? { title } : {}),
        ...(selectedModel ? { model: { id: selectedModel.modelID, providerID: selectedModel.providerID } } : {}),
        location: { directory },
      }
      : (title ? { title } : {});
    const value = await this.http.request(this.sessionRoute(), this.apiVersion === "v2" ? undefined : { directory }, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const session = parseOpenCodeSession(this.apiVersion === "v2" ? unwrapData(value) : value);
    if (!session) throw new Error("OpenCode returned an invalid session response.");
    return session;
  }

  async rename(sessionId: string, title: string): Promise<void> {
    await this.http.request(
      `${this.sessionRoute()}/${encodeURIComponent(sessionId)}${this.apiVersion === "v2" ? "/rename" : ""}`,
      undefined,
      {
        method: this.apiVersion === "v2" ? "POST" : "PATCH",
        body: JSON.stringify({ title }),
      },
    );
  }

  async delete(sessionId: string): Promise<void> {
    try {
      const result = await this.http.request(`${this.sessionRoute()}/${encodeURIComponent(sessionId)}`, undefined, { method: "DELETE" });
      if (unwrapData(result) === false) throw new Error("OpenCode reported that the session was not deleted.");
    } catch (error) {
      if (await this.isMissing(sessionId)) return;
      throw error;
    }
  }

  async fork(sessionId: string, throughMessageId?: string): Promise<OpenCodeSessionInfo> {
    let boundaryMessageId: string | undefined;
    if (throughMessageId) {
      const messages = await this.messages.list(sessionId);
      const messageIndex = messages.findIndex((message) => message.info?.id === throughMessageId);
      if (messageIndex < 0) throw new Error("OpenCode could not find the selected message in this session.");
      // OpenCode copies messages before messageID, so use the following message as the exclusive boundary.
      boundaryMessageId = messages[messageIndex + 1]?.info?.id;
    }
    const value = await this.http.request(`${this.sessionRoute()}/${encodeURIComponent(sessionId)}/fork`, undefined, {
      method: "POST",
      body: JSON.stringify(boundaryMessageId ? { messageID: boundaryMessageId } : {}),
    });
    const session = parseOpenCodeSession(this.apiVersion === "v2" ? unwrapData(value) : value);
    if (!session) throw new Error("OpenCode returned an invalid fork response.");
    return session;
  }

  private async isMissing(sessionId: string): Promise<boolean> {
    try {
      await this.get(sessionId, AbortSignal.timeout(5_000));
      return false;
    } catch (error) {
      return errorMessage(error).includes("OpenCode 서버 응답 오류 404");
    }
  }

  private sessionRoute(): string {
    return this.apiVersion === "v2" ? "/api/session" : "/session";
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
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
