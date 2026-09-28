/** Converts OpenCode session/message DTOs into Hive conversation records. */
export type OpenCodeSessionInfo = {
  id: string;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
  location?: { directory?: string };
  model?: unknown;
};

export type OpenCodeMessage = {
  info?: {
    id?: string;
    role?: string;
    type?: string;
    outcome?: string;
    time?: { created?: number; completed?: number };
    providerID?: string;
    modelID?: string;
    finish?: unknown;
  };
  parts?: unknown[];
};
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

export function parseOpenCodeSession(value: unknown): OpenCodeSessionInfo | undefined {
  const session = asObject(value);
  if (!session || typeof session.id !== "string" || !session.id.trim()) return undefined;
  const time = asObject(session.time);
  const location = asObject(session.location);
  return {
    id: session.id,
    ...(typeof session.title === "string" ? { title: session.title } : {}),
    ...(typeof session.directory === "string" ? { directory: session.directory } : {}),
    ...(time ? { time: {
      ...(typeof time.created === "number" ? { created: time.created } : {}),
      ...(typeof time.updated === "number" ? { updated: time.updated } : {}),
    } } : {}),
    ...(typeof location?.directory === "string" ? { location: { directory: location.directory } } : {}),
    ...(session.model !== undefined ? { model: session.model } : {}),
  };
}

export function parseOpenCodeMessage(value: unknown): OpenCodeMessage | undefined {
  const message = asObject(value);
  if (!message) return undefined;
  const info = asObject(message.info);
  const time = asObject(info?.time);
  return {
    ...(info ? { info: {
      ...(typeof info.id === "string" ? { id: info.id } : {}),
      ...(typeof info.role === "string" ? { role: info.role } : {}),
      ...(typeof info.type === "string" ? { type: info.type } : {}),
      ...(typeof info.outcome === "string" ? { outcome: info.outcome } : {}),
      ...(time ? { time: {
        ...(typeof time.created === "number" ? { created: time.created } : {}),
        ...(typeof time.completed === "number" ? { completed: time.completed } : {}),
      } } : {}),
      ...(typeof info.providerID === "string" ? { providerID: info.providerID } : {}),
      ...(typeof info.modelID === "string" ? { modelID: info.modelID } : {}),
      ...(info.finish !== undefined ? { finish: info.finish } : {}),
    } } : {}),
    ...(Array.isArray(message.parts) ? { parts: message.parts } : {}),
  };
}

export function normalizeV2Message(value: JsonObject): OpenCodeMessage {
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
    const providerID = firstString(model.providerID);
    const modelID = firstString(model.id, model.modelID);
    const content = Array.isArray(value.content) ? value.content : [];
    return {
      info: {
        ...(id ? { id } : {}),
        role: "assistant",
        type,
        time: messageTime,
        ...(providerID ? { providerID } : {}),
        ...(modelID ? { modelID } : {}),
        ...(value.finish !== undefined ? { finish: value.finish } : {}),
      },
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


type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}
