import type { AssistantThread, TranscriptEntry } from "../../../domain/assistant.js";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import { kiroEffortOptions, kiroModes, loadKiroSkills, withKiroEffortOptions } from "./session-catalog-mapper.js";
import { subscribeKiroSession } from "./session-events.js";
import { collectKiroTranscript } from "./session-update-mapper.js";
import { deleteKiroSession, listKiroModels, listKiroSessions } from "./cli.js";
import { forgetKiroSessionAlias, forgetKiroSessionPolicyPresets, getKiroSessionPolicyPresets, isValidKiroSessionId, listKiroPermissionPresetOptions, renameKiroSession, saveKiroSessionPolicyPresets, validateKiroPermissionPresets } from "./session-metadata.js";
import { KiroSessionContext, type KiroRemoteSession } from "./session-context.js";
import { asObject, errorMessage, firstString, type JsonObject } from "./session-utils.js";
import { KiroThreadAccess } from "./thread-access.js";

/** Owns Kiro connection catalog, session lifecycle, and thread hydration. */
export class KiroSessionCatalogAdapter implements ProviderCatalogPort, ProviderSessionPort, ProviderConversationPort {
  private readonly threadAccess: KiroThreadAccess;

  constructor(
    private readonly context: KiroSessionContext,
    private readonly publish: AssistantEventPublisher,
  ) {
    this.threadAccess = new KiroThreadAccess(context);
  }

  async connect(target: string): Promise<ProviderConnectionCatalog> {
    const session = await this.context.getOrConnect(target);
    let modelWarning: string | undefined;
    if (!session.models.length) {
      try {
        session.models = await listKiroModels(target);
      } catch (error) {
        modelWarning = errorMessage(error);
      }
    }
    return {
      threads: (await listKiroSessions(target)).map((thread) => ({ ...thread, provider: "kiro" as const })),
      models: session.models,
      permissionPresets: listKiroPermissionPresetOptions(),
      ...(modelWarning ? { modelWarning } : {}),
    };
  }

  async refresh(target: string): Promise<AssistantThread[]> {
    return (await listKiroSessions(target)).map((thread) => ({ ...thread, provider: "kiro" as const }));
  }

  async createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> {
    const session = await this.context.getOrConnect(target);
    const selectedPresets = validateKiroPermissionPresets(input.permissionPresets ?? []);
    const created = await session.connection.newSession(input.cwd, selectedPresets);
    const threadId = firstString(created.sessionId, created.id);
    if (!threadId || !isValidKiroSessionId(threadId)) throw new Error("Kiro returned an invalid session/new response");
    const model = session.models.find((candidate) => candidate.isDefault)?.model ?? "auto";
    const requestedName = input.name?.trim();
    const title = requestedName ? requestedName.slice(0, 120) : "Kiro 세션";
    if (title !== "Kiro 세션") await renameKiroSession(target, threadId, title);
    await saveKiroSessionPolicyPresets(target, threadId, selectedPresets);
    session.openedThreadIds.add(threadId);
    session.cwdByThread.set(threadId, input.cwd);
    session.settingsByThread.set(threadId, { model, effort: null });
    session.policyPresetsByThread.set(threadId, selectedPresets);
    session.transcriptsByThread.set(threadId, []);
    const modes = kiroModes(created);
    if (modes.length) session.modesByThread.set(threadId, modes);
    const currentModeId = firstString(asObject(created.modes)?.currentModeId);
    if (currentModeId) session.currentModeByThread.set(threadId, currentModeId);
    subscribeKiroSession(session, target, threadId, this.publish);
    const skills = await loadKiroSkills(session, target, threadId, input.cwd);
    const effortOptions = await kiroEffortOptions(session, threadId);
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
      permissionProfile: selectedPresets.length ? selectedPresets.join(",") : null,
    };
  }

  async openThread(target: string, threadId: string): Promise<ProviderOpenThreadResult> {
    return this.threadAccess.openThread(target, threadId, (openTarget, openThreadId) => this.loadThread(openTarget, openThreadId));
  }

  private async loadThread(target: string, threadId: string): Promise<ProviderOpenThreadResult> {
    const session = await this.context.getOrConnect(target);
    const metadata = (await listKiroSessions(target)).find((thread) => thread.id === threadId);
    if (!metadata) throw new Error("Kiro session was not found. Refresh the session list and try again.");
    const policyPresets = session.policyPresetsByThread.get(threadId) ?? await getKiroSessionPolicyPresets(target, threadId);
    if (policyPresets.length) session.policyPresetsByThread.set(threadId, policyPresets);
    const replay: TranscriptEntry[] = [];
    session.updateUnsubscribers.get(threadId)?.();
    session.updateUnsubscribers.delete(threadId);
    const unsubscribe = session.connection.onSessionUpdate(threadId, ({ update }) => collectKiroTranscript(replay, update));
    let loaded: JsonObject;
    try {
      loaded = await session.connection.loadSession(threadId, metadata.cwd, policyPresets);
    } finally {
      unsubscribe();
    }
    const model = firstString(loaded.modelId, loaded.currentModelId, asObject(loaded.models)?.currentModelId) ??
      session.settingsByThread.get(threadId)?.model ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "auto";
    session.openedThreadIds.add(threadId);
    session.cwdByThread.set(threadId, metadata.cwd);
    const effortOptions = await kiroEffortOptions(session, threadId);
    const effort = effortOptions.current ?? session.settingsByThread.get(threadId)?.effort ?? null;
    session.settingsByThread.set(threadId, { model, effort });
    session.models = withKiroEffortOptions(session.models, model, effortOptions.options);
    subscribeKiroSession(session, target, threadId, this.publish);
    session.transcriptsByThread.set(threadId, replay);
    const skills = await loadKiroSkills(session, target, threadId, metadata.cwd);
    const modes = kiroModes(loaded);
    if (modes.length) session.modesByThread.set(threadId, modes);
    const currentModeId = firstString(asObject(loaded.modes)?.currentModeId, session.currentModeByThread.get(threadId));
    if (currentModeId) session.currentModeByThread.set(threadId, currentModeId);
    return {
      target,
      threadId,
      title: metadata.title,
      cwd: metadata.cwd,
      entries: replay,
      skills,
      skillWarnings: [],
      modes,
      currentModeId: currentModeId ?? null,
      models: session.models,
      model,
      reasoningEffort: effort,
      permissionProfile: session.policyPresetsByThread.get(threadId)?.join(",") ?? null,
    };
  }

  renameThread(target: string, threadId: string, name: string): Promise<void> {
    return renameKiroSession(target, threadId, name);
  }

  async deleteThread(target: string, threadId: string): Promise<void> {
    const session = this.context.get(target);
    await this.context.runAfterClosingConnection(target, () => deleteKiroSession(target, threadId));
    await forgetKiroSessionAlias(target, threadId);
    await forgetKiroSessionPolicyPresets(target, threadId);
    session?.updateUnsubscribers.get(threadId)?.();
    session?.updateUnsubscribers.delete(threadId);
    session?.openedThreadIds.delete(threadId);
    session?.settingsByThread.delete(threadId);
    session?.cwdByThread.delete(threadId);
    session?.policyPresetsByThread.delete(threadId);
    session?.activeTurnIds.delete(threadId);
    session?.commandsByThread.delete(threadId);
    session?.skillsByThread.delete(threadId);
    session?.modesByThread.delete(threadId);
    session?.currentModeByThread.delete(threadId);
    session?.transcriptsByThread.delete(threadId);
    this.context.forgetDisconnectedThread(target, threadId);
  }

  disconnect(target: string): Promise<void> {
    return this.context.disconnect(target);
  }

  terminateAll(): void {
    this.context.terminateAll();
  }

  async requireOpenThread(target: string, threadId: string): Promise<KiroRemoteSession> {
    return this.threadAccess.requireOpenThread(target, threadId, (openTarget, openThreadId) => this.openThread(openTarget, openThreadId));
  }
}
