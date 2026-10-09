/** OpenCode session and message shapes accepted by the versioned HTTP API. */
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

/** Parse the fields shared by OpenCode session endpoints into a stable adapter model. */
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

/** Parse a version-neutral OpenCode message without trusting its response object. */
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

/** Convert OpenCode v2 content records into the adapter's version-neutral message shape. */
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
