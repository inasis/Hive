import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { providerPromptTranscript } from "../a2a-prompt-context.js";
import { asObject } from "./session-json-values.js";
import { modelKey } from "./model-catalog.js";
import type { JsonObject, PiThreadDescriptor } from "./session-types.js";

const SESSION_LINE_LIMIT = 16 * 1024 * 1024;

export async function listPiSessions(directory: string): Promise<PiThreadDescriptor[]> {
  let files: string[];
  try {
    files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
  const sessions = await Promise.all(files.map(readPiSessionDescriptor));
  return sessions.flatMap((session) => session ? [session] : []);
}

async function readPiSessionDescriptor(sessionFile: string): Promise<PiThreadDescriptor | undefined> {
  let buffer = Buffer.alloc(0);
  let header: JsonObject | undefined;
  let title: string | undefined;
  let sessionName: string | undefined;
  let preview = "";
  let updatedAt: string | number | null = null;
  let model: string | undefined;
  try {
    for await (const chunk of createReadStream(sessionFile)) {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      let delimiter: number;
      while ((delimiter = buffer.indexOf(0x0a)) >= 0) {
        const line = buffer.subarray(0, delimiter);
        buffer = buffer.subarray(delimiter + 1);
        if (!line.length) continue;
        if (line.length > SESSION_LINE_LIMIT) return undefined;
        let entry: JsonObject | undefined;
        try { entry = asObject(JSON.parse(line.toString("utf8"))); } catch { continue; }
        if (!entry) continue;
        if (!header) {
          if (entry.type !== "session") return undefined;
          header = entry;
          if (typeof entry.timestamp === "string" || typeof entry.timestamp === "number") updatedAt = entry.timestamp;
          continue;
        }
        if (entry.type === "session_info") {
          sessionName = optionalString(entry.name);
          if (sessionName) title = sessionName;
        }
        if (entry.type === "model_change") {
          const provider = optionalString(entry.provider);
          const id = optionalString(entry.modelId);
          if (provider && id) model = modelKey(provider, id);
        }
        if (entry.type === "message") {
          const message = asObject(entry.message);
          const role = optionalString(message?.role);
          const content = Array.isArray(message?.content) ? message.content : [];
          const text = content.flatMap((part) => {
            const block = asObject(part);
            return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
          }).join("\n");
          if (role === "user" && text.trim()) {
            const prompt = providerPromptTranscript(text).text;
            if (prompt.trim()) {
              preview = prompt;
              title ??= prompt.replace(/\s+/g, " ").trim().slice(0, 72);
            }
          }
          if (role === "assistant") {
            const provider = optionalString(message?.provider);
            const id = optionalString(message?.model);
            if (provider && id) model = modelKey(provider, id);
          }
          const time = message?.timestamp;
          if (typeof time === "number" || typeof time === "string") updatedAt = time;
        }
      }
      if (buffer.length > SESSION_LINE_LIMIT) return undefined;
    }
    if (buffer.length > 0) {
      let entry: JsonObject | undefined;
      try { entry = asObject(JSON.parse(buffer.toString("utf8"))); } catch {}
      if (entry?.type === "session_info") {
        sessionName = optionalString(entry.name);
        if (sessionName) title = sessionName;
      }
    }
  } catch {
    return undefined;
  }
  const id = optionalString(header?.id);
  const cwd = optionalString(header?.cwd);
  if (!header || !id || !cwd) return undefined;
  return {
    thread: { id, provider: "pi", title: title || "새 Pi 세션", cwd, preview, updatedAt },
    sessionFile,
    ...(model ? { model } : {}),
    ...(sessionName ? { sessionName } : {}),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
