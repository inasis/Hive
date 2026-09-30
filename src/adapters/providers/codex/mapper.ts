import type { CodexAppServerApi, CodexThread } from "./app-server.js";
import type { AssistantSkill, AssistantThread } from "../../../domain/assistant.js";
import type { AvailableSkill } from "../../../application/ports/skills.js";

/** Convert Codex app-server session catalogs into provider-neutral domain models. */
export async function listCodexThreads(api: Pick<CodexAppServerApi, "listThreads">): Promise<AssistantThread[]> {
  const threads = await api.listThreads({ limit: 500 });
  return threads.map(mapCodexThread);
}

export function mapCodexThread(thread: CodexThread): AssistantThread {
  const id = firstString(thread.id);
  if (!id) throw new Error("Codex returned a session without an ID");
  return {
    id,
    title: firstString(thread.title, thread.name, thread.preview) ?? "Untitled session",
    cwd: firstString(thread.cwd) ?? "",
    preview: firstString(thread.preview) ?? "",
    updatedAt: typeof thread.updatedAt === "string" || typeof thread.updatedAt === "number" ? thread.updatedAt : null,
    provider: "codex",
  };
}

export function mapCodexSkill(skill: AvailableSkill): AssistantSkill {
  return {
    id: JSON.stringify([skill.provider, skill.name, skill.path]),
    name: skill.name,
    description: skill.description,
    provider: skill.provider,
    scope: skill.scope,
    enabled: skill.enabled,
  };
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}
