import type { AssistantThread } from "../../../domain/assistant.js";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadOptions, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import { kiroEffortOptions, kiroModes, loadKiroSkills, withKiroEffortOptions } from "./session-catalog-mapper.js";
import { subscribeKiroSession } from "./session-events.js";
import { listKiroSessions } from "./cli.js";
import { renameKiroSession, saveKiroSessionPolicyPresets } from "../../persistence/kiro-session-metadata.js";
import { isValidKiroSessionId, kiroPermissionProfileForPresets, validateKiroPermissionPresets } from "./session-metadata.js";
import { KiroSessionContext } from "./session-context.js";
import type { KiroRemoteSession } from "./session-types.js";
import { asObject, firstString } from "./session-utils.js";
import { KiroThreadAccess } from "./thread-access.js";
import { createKiroA2AMcpServers } from "./a2a-mcp-server.js";
import { loadKiroSessionThread } from "./kiro-session-thread-loader.js";

/** Owns Kiro conversation creation and provider-thread hydration. */
export class KiroSessionConversationAdapter implements ProviderConversationPort {
  private readonly threadAccess: KiroThreadAccess;

  constructor(
    private readonly context: KiroSessionContext,
    private readonly publish: AssistantEventPublisher,
  ) {
    this.threadAccess = new KiroThreadAccess(context);
  }

  async createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> {
    const session = await this.context.getOrConnect(target);
    const policyPresets = validateKiroPermissionPresets(["allow-all"]);
    const created = await session.connection.newSession(input.cwd, policyPresets, createKiroA2AMcpServers(target));
    const threadId = firstString(created.sessionId, created.id);
    if (!threadId || !isValidKiroSessionId(threadId)) throw new Error("Kiro returned an invalid session/new response");
    const model = session.models.find((candidate) => candidate.isDefault)?.model ?? "auto";
    const requestedName = input.name?.trim();
    const title = requestedName ? requestedName.slice(0, 120) : "Kiro 세션";
    if (title !== "Kiro 세션") await renameKiroSession(target, threadId, title);
    await saveKiroSessionPolicyPresets(target, threadId, policyPresets);
    session.openedThreadIds.add(threadId);
    session.cwdByThread.set(threadId, input.cwd);
    session.settingsByThread.set(threadId, { model, effort: null });
    session.policyPresetsByThread.set(threadId, policyPresets);
    session.transcriptsByThread.set(threadId, []);
    const modes = kiroModes(created);
    if (modes.length) session.modesByThread.set(threadId, modes);
    const currentModeId = firstString(asObject(created.modes)?.currentModeId);
    if (currentModeId) session.currentModeByThread.set(threadId, currentModeId);
    subscribeKiroSession(session, target, threadId, this.publish);
    const skills = input.minimal ? [] : await loadKiroSkills(session, target, threadId, input.cwd);
    const effortOptions = input.minimal
      ? { current: null, options: [] }
      : await kiroEffortOptions(session, threadId);
    if (effortOptions.current) session.settingsByThread.set(threadId, { model, effort: effortOptions.current });
    session.models = withKiroEffortOptions(session.models, model, effortOptions.options);
    const thread: AssistantThread = {
      id: threadId,
      title,
      cwd: input.cwd,
      preview: "",
      updatedAt: Date.now(),
      provider: "kiro",
    };
    return {
      thread,
      threadId,
      title,
      cwd: input.cwd,
      entries: [],
      skills,
      skillWarnings: [],
      modes,
      currentModeId: currentModeId ?? null,
      models: session.models,
      model,
      reasoningEffort: effortOptions.current ?? null,
      permissionProfile: kiroPermissionProfileForPresets(policyPresets),
      requiresFocusRestoreAfterDelete: true,
    };
  }

  async openThread(target: string, threadId: string, options: ProviderOpenThreadOptions = { includeTranscript: true }): Promise<ProviderOpenThreadResult> {
    if (!options.includeTranscript) {
      const warmResult = await this.openWarmThread(target, threadId, options);
      if (warmResult) return warmResult;
    }
    return this.threadAccess.openThread(target, threadId, loadKiroSessionThread.bind(undefined, this.context, this.publish), options);
  }

  requireOpenThread(target: string, threadId: string): Promise<KiroRemoteSession> {
    return this.threadAccess.requireOpenThread(target, threadId, (openTarget, openThreadId) => this.openThread(openTarget, openThreadId));
  }

  private async openWarmThread(target: string, threadId: string, options: ProviderOpenThreadOptions): Promise<ProviderOpenThreadResult | undefined> {
    const session = this.context.get(target);
    if (!session?.connection.isOpen || !session.openedThreadIds.has(threadId) || this.context.isThreadDisconnected(target, threadId)) return undefined;
    const metadata = (await listKiroSessions(target)).find((thread) => thread.id === threadId);
    if (!metadata) return undefined;
    const settings = session.settingsByThread.get(threadId);
    const model = settings?.model ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "auto";
    const policyPresets = session.policyPresetsByThread.get(threadId) ?? [];
    return {
      target,
      threadId,
      title: metadata.title,
      cwd: metadata.cwd,
      entries: [],
      skills: options.minimal ? [] : session.skillsByThread.get(threadId) ?? [],
      skillWarnings: [],
      modes: session.modesByThread.get(threadId) ?? [],
      currentModeId: session.currentModeByThread.get(threadId) ?? null,
      models: session.models,
      model,
      reasoningEffort: settings?.effort ?? null,
      permissionProfile: kiroPermissionProfileForPresets(policyPresets),
    };
  }
}
