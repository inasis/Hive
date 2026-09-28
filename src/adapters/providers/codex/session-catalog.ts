import type { CodexCliOpenedSession } from "../../../application/ports/codex-cli.js";
import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import type { AssistantThread } from "../../../domain/assistant.js";
import { discoverCodexSkills } from "./skill-catalog.js";
import { listCodexThreads, mapCodexSkill, mapCodexThread } from "./mapper.js";
import { mapCodexTranscript } from "./history-mapper.js";
import { formatCodexTargetLabel, type CodexSessionContext } from "./session-context.js";
import { listCodexPermissionPresetOptions } from "./session-metadata.js";
import { asObject, errorMessage, firstString } from "./protocol-utils.js";

/** Implements Codex catalog, session lifecycle, and conversation hydration. */
export class CodexSessionCatalogAdapter implements ProviderCatalogPort, ProviderSessionPort, ProviderConversationPort {
  constructor(private readonly context: CodexSessionContext) {}

  async connect(target: string): Promise<ProviderConnectionCatalog> {
    const session = await this.context.getOrConnect(target);
    let modelWarning: string | undefined;
    if (session.models.length === 0) {
      try {
        session.models = await session.api.listModels();
      } catch (error) {
        modelWarning = errorMessage(error);
      }
    }
    return {
      threads: await listCodexThreads(session.api),
      models: session.models,
      permissionPresets: listCodexPermissionPresetOptions(),
      ...(modelWarning ? { modelWarning } : {}),
    };
  }

  async refresh(target: string): Promise<AssistantThread[]> {
    const session = await this.context.getOrConnect(target);
    return listCodexThreads(session.api);
  }

  async renameThread(target: string, threadId: string, name: string): Promise<void> {
    const session = await this.context.getOrConnect(target);
    await session.api.setThreadName(threadId, name);
  }

  async deleteThread(target: string, threadId: string): Promise<void> {
    const session = await this.context.getOrConnect(target);
    try {
      await session.api.deleteThread(threadId);
    } catch (error) {
      // The app-server may complete deletion but lose or delay the response. Confirm against its
      // authoritative list before reporting failure to the UI.
      try {
        const remaining = await session.api.listThreads({ limit: 500, timeoutMs: 10_000 });
        if (remaining.some((thread) => thread.id === threadId)) throw error;
      } catch (verificationError) {
        if (verificationError === error) throw error;
        throw new Error(`${errorMessage(error)} (삭제 여부를 확인하지 못했습니다: ${errorMessage(verificationError)})`, { cause: error });
      }
    }
    session.openedThreadIds.delete(threadId);
    session.skillsByThread.delete(threadId);
    session.settingsByThread.delete(threadId);
    if (session.activeThreadId === threadId) delete session.activeThreadId;
  }

  async createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> {
    const session = await this.context.getOrConnect(target);
    const started = asObject(await session.api.startThread(input.cwd));
    const rawThread = asObject(started?.thread);
    const threadId = firstString(rawThread?.id);
    if (!started || !rawThread || !threadId) throw new Error("Codex returned an invalid thread/start response");

    const cwd = firstString(started.cwd, rawThread.cwd, input.cwd) ?? input.cwd;
    const title = firstString(rawThread.name, rawThread.title, rawThread.preview) ?? "새 세션";
    const model = firstString(started.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(started.reasoningEffort) ?? null;
    const permissionProfile = firstString(asObject(started.activePermissionProfile)?.id) ?? null;
    const thread = mapCodexThread({ id: threadId, title, cwd, preview: "", updatedAt: Date.now() });
    session.activeThreadId = threadId;
    session.openedThreadIds.add(threadId);
    session.settingsByThread.set(threadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode: "default" });
    const catalog = await discoverCodexSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(threadId, catalog);
    return {
      thread,
      threadId,
      title,
      cwd,
      entries: [],
      skills: catalog.skills.map(mapCodexSkill),
      skillWarnings: catalog.warnings,
      model,
      reasoningEffort,
      permissionProfile,
    };
  }

  async openThread(target: string, threadId: string): Promise<ProviderOpenThreadResult> {
    const session = await this.context.getOrConnect(target);
    const threadRead = await session.api.readThread(threadId);
    const thread = asObject(threadRead.thread);
    if (!thread) throw new Error("Codex returned an invalid thread/read response");
    const resumed = asObject(await session.api.resumeThread(threadId, { excludeTurns: true }));
    const resumedThread = asObject(resumed?.thread);
    if (!resumedThread) throw new Error("Codex returned an invalid thread/resume response");

    const cwd = firstString(resumedThread.cwd, thread.cwd) ?? "";
    const model = firstString(resumed?.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(resumed?.reasoningEffort) ?? null;
    const permissionProfile = firstString(asObject(resumed?.activePermissionProfile)?.id) ?? null;
    session.activeThreadId = threadId;
    session.openedThreadIds.add(threadId);
    const collaborationMode = firstString(asObject(resumed?.collaborationMode)?.mode) === "plan" ? "plan" : "default";
    session.settingsByThread.set(threadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode });
    const catalog = await discoverCodexSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(threadId, catalog);
    return {
      target,
      threadId,
      title: firstString(resumedThread.name, resumedThread.title, thread.name, thread.title, thread.preview) ?? threadId,
      cwd,
      entries: mapCodexTranscript(thread),
      skills: catalog.skills.map(mapCodexSkill),
      skillWarnings: catalog.warnings,
      model,
      reasoningEffort,
      permissionProfile,
    };
  }

  async openSession(target: string, threadId: string): Promise<CodexCliOpenedSession> {
    const session = await this.context.getOrConnect(target);
    const metadata = asObject(await session.api.readThreadMetadata(threadId));
    const storedThread = asObject(metadata?.thread);
    if (!storedThread) throw new Error("Codex returned an invalid thread/read response");
    const resumeResponse = asObject(await session.api.resumeThread(threadId, { excludeTurns: true }));
    const resumedThread = asObject(resumeResponse?.thread);
    if (!resumedThread) throw new Error("Codex returned an invalid thread/resume response");

    const cwd = typeof resumedThread.cwd === "string" ? resumedThread.cwd : undefined;
    const model = firstString(resumeResponse?.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(resumeResponse?.reasoningEffort) ?? null;
    const permissionProfile = firstString(asObject(resumeResponse?.activePermissionProfile)?.id) ?? null;
    const collaborationMode = firstString(asObject(resumeResponse?.collaborationMode)?.mode) === "plan" ? "plan" : "default";
    session.activeThreadId = threadId;
    session.openedThreadIds.add(threadId);
    session.settingsByThread.set(threadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode });
    const skillCatalog = await discoverCodexSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(threadId, skillCatalog);
    return {
      targetLabel: formatCodexTargetLabel(target),
      ...(typeof resumedThread.name === "string" ? { title: resumedThread.name } : {}),
      ...(cwd ? { cwd } : {}),
      skillCatalog,
    };
  }

  disconnect(target: string): Promise<void> {
    return this.context.disconnect(target);
  }
}
