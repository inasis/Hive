import type { AssistantThread, TranscriptEntry } from "../../../domain/assistant.js";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import type { ProviderConversationPort, ProviderCreateThreadInput, ProviderCreateThreadResult, ProviderOpenThreadOptions, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import { kiroEffortOptions, kiroModes, loadKiroSkills, withKiroEffortOptions } from "./session-catalog-mapper.js";
import { subscribeKiroSession } from "./session-events.js";
import { collectKiroTranscript } from "./session-update-mapper.js";
import { deleteKiroSession, listKiroModels, listKiroSessions } from "./cli.js";
import { forgetKiroSessionAlias, forgetKiroSessionPolicyPresets, getKiroSessionPolicyPresets, renameKiroSession, saveKiroSessionPolicyPresets } from "../../persistence/kiro-session-metadata.js";
import { isValidKiroSessionId, kiroPermissionProfileForPresets, listKiroPermissionPresetOptions, validateKiroPermissionPresets } from "./session-metadata.js";
import { KiroSessionContext, type KiroRemoteSession } from "./session-context.js";
import { asObject, errorMessage, firstString, type JsonObject } from "./session-utils.js";
import { KiroThreadAccess } from "./thread-access.js";
import { createKiroA2AMcpServers } from "./a2a-mcp-server.js";
import { providerA2ASummaryEntryId, providerPromptTranscript } from "../a2a-prompt-context.js";

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
    return this.threadAccess.openThread(target, threadId, (openTarget, openThreadId, loadOptions) => this.loadThread(openTarget, openThreadId, loadOptions), options);
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

  private async loadThread(target: string, threadId: string, options: ProviderOpenThreadOptions = { includeTranscript: true }): Promise<ProviderOpenThreadResult> {
    const session = await this.context.getOrConnect(target);
    const metadata = (await listKiroSessions(target)).find((thread) => thread.id === threadId);
    if (!metadata) throw new Error("Kiro session was not found. Refresh the session list and try again.");
    const policyPresets = session.policyPresetsByThread.get(threadId) ?? await getKiroSessionPolicyPresets(target, threadId);
    session.policyPresetsByThread.set(threadId, policyPresets);
    const replay: TranscriptEntry[] = [];
    session.updateUnsubscribers.get(threadId)?.();
    session.updateUnsubscribers.delete(threadId);
    const unsubscribe = options.includeTranscript
      ? session.connection.onSessionUpdate(threadId, ({ update }) => collectKiroTranscript(replay, update))
      : undefined;
    let loaded: JsonObject;
    try {
      loaded = await session.connection.loadSession(threadId, metadata.cwd, policyPresets, createKiroA2AMcpServers(target));
    } finally {
      unsubscribe?.();
    }
    const model = firstString(loaded.modelId, loaded.currentModelId, asObject(loaded.models)?.currentModelId) ??
      session.settingsByThread.get(threadId)?.model ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "auto";
    session.openedThreadIds.add(threadId);
    session.cwdByThread.set(threadId, metadata.cwd);
    const effortOptions = options.minimal
      ? undefined
      : await kiroEffortOptions(session, threadId);
    const effort = effortOptions?.current ?? session.settingsByThread.get(threadId)?.effort ?? null;
    session.settingsByThread.set(threadId, { model, effort });
    if (effortOptions) session.models = withKiroEffortOptions(session.models, model, effortOptions.options);
    subscribeKiroSession(session, target, threadId, this.publish);
    session.transcriptsByThread.set(threadId, replay);
    const skills = options.minimal
      ? session.skillsByThread.get(threadId) ?? []
      : await loadKiroSkills(session, target, threadId, metadata.cwd);
    const modes = kiroModes(loaded);
    if (modes.length) session.modesByThread.set(threadId, modes);
    const currentModeId = firstString(asObject(loaded.modes)?.currentModeId, session.currentModeByThread.get(threadId));
    if (currentModeId) session.currentModeByThread.set(threadId, currentModeId);
    return {
      target,
      threadId,
      title: metadata.title,
      cwd: metadata.cwd,
      entries: options.includeTranscript
        ? replay.flatMap((entry) => {
            if (entry.role !== "user") return [entry];
            const prompt = providerPromptTranscript(entry.text);
            return [
              ...(prompt.text ? [{ ...entry, text: prompt.text }] : []),
              ...(prompt.communications.length ? [{
                id: providerA2ASummaryEntryId(prompt.communications),
                role: "communication" as const,
                text: "",
                ...(entry.turnId ? { turnId: entry.turnId } : {}),
                communications: prompt.communications,
              }] : []),
            ];
          })
        : [],
      skills,
      skillWarnings: [],
      modes,
      currentModeId: currentModeId ?? null,
      models: session.models,
      model,
      reasoningEffort: effort,
      permissionProfile: kiroPermissionProfileForPresets(policyPresets),
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
