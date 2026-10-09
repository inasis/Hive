import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadOptions, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import { discoverCodexSkills } from "./skill-catalog.js";
import { mapCodexSkill, mapCodexThread } from "./mapper.js";
import { mapCodexTranscript } from "./history-mapper.js";
import { type CodexSessionContext } from "./session-context.js";
import { asObject, firstString } from "./protocol-utils.js";

/** Owns Codex conversation creation and provider-thread hydration. */
export class CodexSessionConversationAdapter implements ProviderConversationPort {
  constructor(private readonly context: CodexSessionContext) {}

  async createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> {
    const session = await this.context.getOrConnect(target);
    const started = asObject(await session.api.startThread(input.cwd, input.ephemeral ? { ephemeral: true } : {}));
    const rawThread = asObject(started?.thread);
    const threadId = firstString(rawThread?.id);
    if (!started || !rawThread || !threadId) throw new Error("Codex returned an invalid thread/start response");
    if (input.ephemeral && rawThread.ephemeral !== true) {
      let cleanupError: unknown;
      try {
        await session.api.deleteThread(threadId);
      } catch (error) {
        cleanupError = error;
      }
      throw new Error(
        cleanupError
          ? "Codex did not create an ephemeral A2A session, and its persistent fallback could not be deleted"
          : "Codex app-server does not support ephemeral A2A sessions; refusing to use a persistent thread",
        cleanupError ? { cause: cleanupError } : undefined,
      );
    }

    const cwd = firstString(started.cwd, rawThread.cwd, input.cwd) ?? input.cwd;
    const title = firstString(rawThread.name, rawThread.title, rawThread.preview) ?? "새 세션";
    const model = firstString(started.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(started.reasoningEffort) ?? null;
    const permissionProfile = firstString(asObject(started.activePermissionProfile)?.id) ?? null;
    const thread = mapCodexThread({ id: threadId, title, cwd, preview: "", updatedAt: Date.now() });
    if (!input.preserveActiveThread) session.activeThreadId = threadId;
    session.openedThreadIds.add(threadId);
    session.freshThreadIds.add(threadId);
    session.settingsByThread.set(threadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode: "default" });
    const catalog = input.minimal
      ? { skills: [], warnings: [] }
      : await discoverCodexSkills(session.api, target, cwd || undefined);
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
      currentModeId: "default",
      requiresFocusRestoreAfterDelete: !input.preserveActiveThread,
    };
  }

  async openThread(target: string, threadId: string, options: ProviderOpenThreadOptions = { includeTranscript: true }): Promise<ProviderOpenThreadResult> {
    const session = await this.context.getOrConnect(target);
    const isFreshThread = session.freshThreadIds.has(threadId);
    const wasOpened = session.openedThreadIds.has(threadId);
    const threadReadValue = options.includeTranscript && !isFreshThread
      ? await session.api.readThread(threadId)
      : await session.api.readThreadMetadata(threadId);
    const threadRead = asObject(threadReadValue);
    const thread = asObject(threadRead?.thread);
    if (!thread) throw new Error("Codex returned an invalid thread/read response");
    const knownSettings = session.settingsByThread.get(threadId);
    if (options.minimal && !options.includeTranscript) {
      const cwd = firstString(thread.cwd) ?? "";
      const model = firstString(thread.model, knownSettings?.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
      const reasoningEffort = firstString(thread.reasoningEffort, knownSettings?.effort) ?? null;
      const permissionProfile = knownSettings?.permissionProfile ?? null;
      const collaborationMode = knownSettings?.collaborationMode ?? "default";
      if (knownSettings) {
        session.settingsByThread.set(threadId, { ...knownSettings, model, effort: reasoningEffort });
      }
      const catalog = session.skillsByThread.get(threadId) ?? { skills: [], warnings: [] };
      return {
        target,
        threadId,
        title: firstString(thread.name, thread.title, thread.preview) ?? threadId,
        cwd,
        entries: [],
        skills: catalog.skills.map(mapCodexSkill),
        skillWarnings: catalog.warnings,
        model,
        reasoningEffort,
        permissionProfile,
        currentModeId: collaborationMode,
      };
    }
    // The metadata open owns provider focus. A later transcript-only refresh must not
    // resume an older thread after the user has already switched to another one.
    const shouldResume = !isFreshThread && (!wasOpened || !options.includeTranscript);
    const resumed = shouldResume ? asObject(await session.api.resumeThread(threadId, { excludeTurns: true })) : undefined;
    const resumedThread = isFreshThread || !shouldResume ? thread : asObject(resumed?.thread);
    if (!resumedThread) throw new Error("Codex returned an invalid thread/resume response");

    const cwd = firstString(resumedThread.cwd, thread.cwd) ?? "";
    const model = firstString(resumed?.model, knownSettings?.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(resumed?.reasoningEffort, knownSettings?.effort) ?? null;
    const permissionProfile = firstString(asObject(resumed?.activePermissionProfile)?.id, knownSettings?.permissionProfile) ?? null;
    if (shouldResume || isFreshThread) {
      session.activeThreadId = threadId;
      session.openedThreadIds.add(threadId);
    }
    const collaborationMode = firstString(asObject(resumed?.collaborationMode)?.mode, knownSettings?.collaborationMode) === "plan" ? "plan" : "default";
    session.settingsByThread.set(threadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode });
    const catalog = options.minimal
      ? session.skillsByThread.get(threadId) ?? { skills: [], warnings: [] }
      : await discoverCodexSkills(session.api, target, cwd || undefined);
    if (!options.minimal) session.skillsByThread.set(threadId, catalog);
    return {
      target,
      threadId,
      title: firstString(resumedThread.name, resumedThread.title, thread.name, thread.title, thread.preview) ?? threadId,
      cwd,
      entries: options.includeTranscript && !isFreshThread ? mapCodexTranscript(thread) : [],
      skills: catalog.skills.map(mapCodexSkill),
      skillWarnings: catalog.warnings,
      model,
      reasoningEffort,
      permissionProfile,
      currentModeId: collaborationMode,
    };
  }
}
