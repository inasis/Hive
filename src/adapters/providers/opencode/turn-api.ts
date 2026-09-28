import type { OpenCodeApiVersion } from "./api.js";
import type { OpenCodeMessage } from "./conversation-mapper.js";
import type { OpenCodeHttpClient } from "./http-client.js";
import { parseOpenCodeModelId } from "./model-mapper.js";

export type OpenCodePromptCommand = { name: string; arguments: string };
type ListMessages = (sessionId: string, allPages: boolean) => Promise<OpenCodeMessage[]>;

/** Sends version-specific prompt, model, and interrupt requests to OpenCode. */
export class OpenCodeTurnApi {
  constructor(
    private readonly http: OpenCodeHttpClient,
    private readonly apiVersion: OpenCodeApiVersion,
    private readonly listMessages: ListMessages,
  ) {}

  async setModel(sessionId: string, model: string): Promise<void> {
    const selectedModel = parseOpenCodeModelId(model);
    if (!selectedModel) throw new Error("Select a valid OpenCode model before sending a message.");
    if (this.apiVersion !== "v2") return;
    await this.http.request(`/api/session/${encodeURIComponent(sessionId)}/model`, undefined, {
      method: "POST",
      body: JSON.stringify({ model: { id: selectedModel.modelID, providerID: selectedModel.providerID } }),
    });
  }

  async submit(
    sessionId: string,
    text: string,
    model: string,
    command?: OpenCodePromptCommand,
  ): Promise<Set<string>> {
    const selectedModel = parseOpenCodeModelId(model);
    if (!selectedModel) throw new Error("OpenCode 세션에 모델이 선택되지 않았습니다. 모델을 선택한 뒤 메시지를 보내세요.");
    const messages = await this.listMessages(sessionId, false);
    const baseline = new Set(messages.map((message) => message.info?.id).filter((id): id is string => typeof id === "string"));

    if (this.apiVersion === "v2") {
      await this.setModel(sessionId, model);
      await this.http.request(`/api/session/${encodeURIComponent(sessionId)}/${command ? "command" : "prompt"}`, undefined, {
        method: "POST",
        body: JSON.stringify(command ? { command: command.name, arguments: command.arguments } : { text }),
      });
    } else {
      await this.http.request(`/session/${encodeURIComponent(sessionId)}/${command ? "command" : "prompt_async"}`, undefined, {
        method: "POST",
        body: JSON.stringify(command ? { command: command.name, arguments: command.arguments } : {
          parts: [{ type: "text", text }],
          model: selectedModel,
        }),
      });
    }
    return baseline;
  }

  async interrupt(sessionId: string): Promise<void> {
    const route = this.apiVersion === "v2" ? "/api/session" : "/session";
    const action = this.apiVersion === "v2" ? "interrupt" : "abort";
    await this.http.request(`${route}/${encodeURIComponent(sessionId)}/${action}`, undefined, { method: "POST" });
  }

  sessionStatuses(signal: AbortSignal): Promise<unknown> {
    return this.http.request("/session/status", undefined, { signal });
  }
}
