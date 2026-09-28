import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import type { AssistantThread } from "../../../domain/assistant.js";
import { defaultOpenCodeModel } from "./model-mapper.js";
import { mapOpenCodeSession, mapOpenCodeTranscript, openCodeModelFromMessages, openCodeModelFromSession } from "./conversation-mapper.js";
import type { OpenCodeProviderSession, OpenCodeSessionContext } from "./session-context.js";
import { mapOpenCodeSkill } from "./skill-mapper.js";

const execFile = promisify(execFileCallback);

/** Implements OpenCode connection catalogs and session hydration/lifecycle operations. */
export class OpenCodeSessionCatalogAdapter implements ProviderCatalogPort, ProviderSessionPort, ProviderConversationPort {
  constructor(private readonly context: OpenCodeSessionContext) {}

  async connect(target: string): Promise<ProviderConnectionCatalog> {
    const session = await this.context.getOrConnect(target);
    const modelWarning = !session.connection.models.some((model) => !model.hidden)
      ? session.connection.modelWarning ?? "OpenCode에서 사용할 수 있는 모델을 찾지 못했습니다. OpenCode의 provider 설정과 인증을 확인하세요."
      : undefined;
    return {
      threads: (await session.connection.listSessions()).map((thread) => ({ ...mapOpenCodeSession(thread), provider: "opencode" as const })),
      models: session.connection.models,
      ...(modelWarning ? { modelWarning } : {}),
    };
  }

  async refresh(target: string): Promise<AssistantThread[]> {
    const threads = await this.context.require(target).connection.listSessions();
    return threads.map((thread) => ({ ...mapOpenCodeSession(thread), provider: "opencode" as const }));
  }

  async createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> {
    const session = this.context.require(target);
    const catalog = await session.connection.listModels(input.cwd);
    const model = defaultOpenCodeModel(catalog.models);
    if (!model) throw new Error(catalog.modelWarning ?? "OpenCode 모델을 찾지 못해 세션을 만들 수 없습니다. 먼저 사용 가능한 모델을 연결하세요.");
    const created = await session.connection.createSession(input.cwd, undefined, model);
    const threadId = created.id;
    const mapped = mapOpenCodeSession(created);
    session.openedThreadIds.add(threadId);
    session.cwdByThread.set(threadId, mapped.cwd || input.cwd);
    session.settingsByThread.set(threadId, { model });
    session.modelsByThread.set(threadId, catalog.models);
    const skillCatalog = await this.context.loadSkills(session, threadId, mapped.cwd || input.cwd);
    const thread: AssistantThread = { ...mapped, cwd: mapped.cwd || input.cwd, provider: "opencode" };
    return {
      thread,
      threadId,
      title: thread.title,
      cwd: thread.cwd,
      entries: [],
      skills: skillCatalog.skills.map(mapOpenCodeSkill),
      skillWarnings: skillCatalog.warnings,
      models: catalog.models,
      ...(catalog.modelWarning ? { modelWarning: catalog.modelWarning } : {}),
      model,
      reasoningEffort: null,
      permissionProfile: null,
    };
  }

  async openThread(target: string, threadId: string): Promise<ProviderOpenThreadResult> {
    const session = this.context.require(target);
    const [thread, messages] = await Promise.all([
      session.connection.getSession(threadId),
      session.connection.listMessages(threadId),
    ]);
    const mapped = mapOpenCodeSession(thread);
    const catalog = await session.connection.listModels(mapped.cwd || undefined);
    const skillCatalog = await this.context.loadSkills(session, threadId, mapped.cwd);
    const model = session.settingsByThread.get(threadId)?.model ??
      openCodeModelFromSession(thread) ??
      openCodeModelFromMessages(messages) ??
      defaultOpenCodeModel(catalog.models) ?? "";
    session.openedThreadIds.add(threadId);
    session.cwdByThread.set(threadId, mapped.cwd);
    session.settingsByThread.set(threadId, { model });
    session.modelsByThread.set(threadId, catalog.models);
    return {
      target,
      threadId,
      title: mapped.title,
      cwd: mapped.cwd,
      entries: mapOpenCodeTranscript(messages),
      skills: skillCatalog.skills.map(mapOpenCodeSkill),
      skillWarnings: skillCatalog.warnings,
      models: catalog.models,
      ...(catalog.modelWarning ? { modelWarning: catalog.modelWarning } : {}),
      model,
      reasoningEffort: null,
      permissionProfile: null,
    };
  }

  async renameThread(target: string, threadId: string, name: string): Promise<void> {
    await this.context.require(target).connection.renameSession(threadId, name);
  }

  async deleteThread(target: string, threadId: string): Promise<void> {
    const session = this.context.require(target);
    await deleteOpenCodeSession(session, threadId);
    session.openedThreadIds.delete(threadId);
    session.settingsByThread.delete(threadId);
    session.modelsByThread.delete(threadId);
    session.cwdByThread.delete(threadId);
    session.skillsByThread.delete(threadId);
  }

  disconnect(target: string): Promise<void> {
    return this.context.disconnect(target);
  }
}

async function deleteOpenCodeSession(session: OpenCodeProviderSession, threadId: string): Promise<void> {
  // A locally managed HTTP server can share OpenCode's session store with its background service.
  // In that setup, HTTP DELETE can hang while the other process owns the session store, so use
  // OpenCode's CLI deletion command for the local store.
  if (!process.env.HIVE_OPENCODE_URL?.trim()) {
    const command = process.env.HIVE_OPENCODE_BIN?.trim() || "opencode";
    try {
      await execFile(command, ["session", "delete", threadId], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      return;
    } catch (error) {
      try {
        await session.connection.getSession(threadId, AbortSignal.timeout(5_000));
      } catch (verificationError) {
        if (errorMessage(verificationError).includes("OpenCode 서버 응답 오류 404")) return;
      }
      throw new Error(`OpenCode 세션 삭제를 완료하지 못했습니다: ${errorMessage(error)}`, { cause: error });
    }
  }

  await session.connection.deleteSession(threadId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
