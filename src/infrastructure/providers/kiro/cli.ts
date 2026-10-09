import type { AssistantModel } from "../../../domain/assistant.js";
import { readKiroSessionAliases } from "../../persistence/kiro-session-metadata.js";
import { isValidKiroSessionId } from "./session-metadata.js";
import { runKiroCli } from "./process.js";

type JsonObject = Record<string, unknown>;
export type KiroSessionInfo = { id: string; title: string; cwd: string; updatedAt: string | number | null; preview: string };

export async function listKiroSessions(target: string): Promise<KiroSessionInfo[]> {
  const output = await runKiroCli(target, ["chat", "--list-sessions", "--all-cwds", "--format", "json"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Kiro CLI returned invalid JSON while listing sessions");
  }
  if (!Array.isArray(parsed)) throw new Error("Kiro CLI returned an invalid session list");

  const sessions: KiroSessionInfo[] = [];
  for (const envelopeValue of parsed) {
    const envelope = asObject(envelopeValue);
    const cwd = stringValue(envelope?.cwd) ?? "";
    const rows = Array.isArray(envelope?.sessions) ? envelope.sessions : [];
    for (const rowValue of rows) {
      const row = asObject(rowValue);
      const id = stringValue(row?.sessionId);
      if (!row || !id || !isValidKiroSessionId(id)) continue;
      const title = stringValue(row.title);
      const count = typeof row.messageCount === "number" && row.messageCount > 0 ? `${row.messageCount}개 메시지` : "";
      sessions.push({
        id,
        title: title && title !== "(no title)" ? title : "Kiro 세션",
        cwd: stringValue(row.cwd) ?? cwd,
        updatedAt: stringValue(row.updatedAt) ?? null,
        preview: count,
      });
    }
  }
  const aliases = await readKiroSessionAliases();
  const targetAliases = aliases[target] ?? {};
  return sessions.map((session) => ({ ...session, title: targetAliases[session.id] ?? session.title }));
}

export async function listKiroModels(target: string): Promise<AssistantModel[]> {
  const output = await runKiroCli(target, ["chat", "--list-models", "--format", "json"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Kiro CLI returned invalid JSON while listing models");
  }
  const response = asObject(parsed);
  const defaultModel = stringValue(response?.default_model);
  const rows = Array.isArray(response?.models) ? response.models : [];
  return rows.flatMap((rowValue): AssistantModel[] => {
    const row = asObject(rowValue);
    const model = stringValue(row?.model_id);
    if (!row || !model) return [];
    return [{
      model,
      displayName: stringValue(row.model_name) ?? model,
      description: stringValue(row.description) ?? "",
      defaultReasoningEffort: "",
      supportedReasoningEfforts: [],
      isDefault: model === defaultModel,
      hidden: false,
    }];
  });
}

export async function deleteKiroSession(target: string, sessionId: string): Promise<void> {
  if (!isValidKiroSessionId(sessionId)) throw new Error("Session ID contains unsupported characters");
  try {
    await runKiroCli(target, ["chat", "--delete-session", sessionId]);
    // Kiro's session catalog can lag behind a successful delete command.
    return;
  } catch (error) {
    try {
      const remaining = await listKiroSessions(target);
      if (!remaining.some((session) => session.id === sessionId)) return;
    } catch (verificationError) {
      throw new Error(`${errorMessage(error)} (Kiro 세션 삭제 여부를 확인하지 못했습니다: ${errorMessage(verificationError)})`, { cause: error });
    }
    throw error;
  }
}


function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
