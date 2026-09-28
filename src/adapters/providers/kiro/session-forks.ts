import type { AssistantMode, AssistantSkill, TranscriptEntry } from "../../../domain/assistant.js";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderForkPort, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../../../application/ports/provider-forks.js";
import { listKiroSessions } from "./cli.js";
import { kiroEffortOptions, kiroModes, loadKiroSkills, withKiroEffortOptions } from "./session-catalog-mapper.js";
import { subscribeKiroSession } from "./session-events.js";
import { collectKiroTranscript } from "./session-update-mapper.js";
import { renameKiroSession, saveKiroSessionPolicyPresets } from "./session-metadata.js";
import type { KiroRemoteSession } from "./session-context.js";
import { asObject, firstString } from "./session-utils.js";
import type { KiroRequireOpenThread } from "./thread-access.js";

/** Implements Kiro's side conversation, rewind, and response fork operations. */
export class KiroSessionForkAdapter implements ProviderForkPort {
  constructor(
    private readonly requireOpenThread: KiroRequireOpenThread,
    private readonly publish: AssistantEventPublisher,
  ) {}

  async forkSideThread(target: string, threadId: string): Promise<ProviderSideConversationResult> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before creating a side conversation");
    const parent = (session.transcriptsByThread.get(threadId) ?? [])
      .filter((entry) => entry.role === "assistant" && entry.responseCompleted !== false)
      .at(-1);
    const forked = await this.rewindConversation(session, target, threadId, parent?.turnId, "사이드 채팅");
    return {
      target,
      threadId: forked.threadId,
      title: forked.title,
      cwd: forked.cwd,
      skills: forked.skills,
      skillWarnings: [],
      modes: forked.modes,
      currentModeId: forked.currentModeId,
      models: session.models,
      model: forked.model,
      reasoningEffort: forked.effort,
      permissionProfile: forked.permissionProfile,
    };
  }

  async forkThread(target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    if (!input.messageId && !input.turnId) throw new Error("Kiro rewind requires the selected completed response");
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before creating a fork");
    const forked = await this.rewindConversation(session, target, threadId, input.turnId, input.name);
    return {
      target,
      threadId: forked.threadId,
      title: forked.title,
      cwd: forked.cwd,
      preview: "",
      updatedAt: Date.now(),
      provider: "kiro",
    };
  }

  async rewindConversation(
    session: KiroRemoteSession,
    target: string,
    sourceThreadId: string,
    selectedTurnId: string | undefined,
    title: string,
  ): Promise<{ threadId: string; title: string; cwd: string; model: string; effort: string | null; permissionProfile: string | null; skills: AssistantSkill[]; modes: AssistantMode[]; currentModeId: string | null }> {
    const transcript = session.transcriptsByThread.get(sourceThreadId) ?? [];
    const userEntries = transcript.filter((entry) => entry.role === "user");
    const selectedUserIndex = selectedTurnId ? userEntries.findIndex((entry) => entry.turnId === selectedTurnId) : -1;
    const selectedIndex = selectedUserIndex >= 0 ? selectedUserIndex : Math.max(0, userEntries.length - 1);
    const rewindIndex = Math.max(1, userEntries.length - selectedIndex);
    const cwd = session.cwdByThread.get(sourceThreadId) ?? "";
    if (!cwd) throw new Error("Kiro workspace path is unavailable for this session");
    const before = await listKiroSessions(target);
    const beforeIds = new Set(before.map((item) => item.id));
    const result = await session.connection.executeCommand(sourceThreadId, "rewind", { index: rewindIndex });
    if (result.success === false) throw new Error(firstString(result.message) ?? "Kiro could not rewind this conversation");
    const data = asObject(result.data);
    let forkedId = firstString(
      result.sessionId,
      result.newSessionId,
      data?.sessionId,
      data?.newSessionId,
      asObject(data?.session)?.sessionId,
      asObject(data?.session)?.id,
    );
    let sessionsAfter = await listKiroSessions(target);
    if (!forkedId || beforeIds.has(forkedId)) {
      const created = sessionsAfter.filter((item) => !beforeIds.has(item.id) && (!item.cwd || item.cwd === cwd))
        .sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
      forkedId = created[0]?.id;
    }
    if (!forkedId || beforeIds.has(forkedId)) {
      throw new Error("Kiro completed /rewind but did not report the new session ID. Refresh sessions and check the Kiro CLI session list.");
    }
    const metadata = sessionsAfter.find((item) => item.id === forkedId);
    const forkCwd = metadata?.cwd || cwd;
    const replay: TranscriptEntry[] = [];
    const unsubscribeReplay = session.connection.onSessionUpdate(forkedId, ({ update }) => collectKiroTranscript(replay, update));
    let loaded: Record<string, unknown>;
    try {
      loaded = await session.connection.loadSession(forkedId, forkCwd, session.policyPresetsByThread.get(sourceThreadId) ?? []);
    } finally {
      unsubscribeReplay();
    }
    const model = firstString(loaded.modelId, loaded.currentModelId, asObject(loaded.models)?.currentModelId) ??
      session.settingsByThread.get(sourceThreadId)?.model ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "auto";
    const effortOptions = await kiroEffortOptions(session, forkedId);
    const effort = effortOptions.current ?? session.settingsByThread.get(sourceThreadId)?.effort ?? null;
    const modes = kiroModes(loaded);
    const currentModeId = firstString(asObject(loaded.modes)?.currentModeId) ?? null;
    const skills = await loadKiroSkills(session, target, forkedId, forkCwd);
    session.openedThreadIds.add(forkedId);
    session.cwdByThread.set(forkedId, forkCwd);
    session.settingsByThread.set(forkedId, { model, effort });
    session.policyPresetsByThread.set(forkedId, [...(session.policyPresetsByThread.get(sourceThreadId) ?? [])]);
    await saveKiroSessionPolicyPresets(target, forkedId, session.policyPresetsByThread.get(forkedId) ?? []);
    session.transcriptsByThread.set(forkedId, replay);
    if (modes.length) session.modesByThread.set(forkedId, modes);
    if (currentModeId) session.currentModeByThread.set(forkedId, currentModeId);
    session.models = withKiroEffortOptions(session.models, model, effortOptions.options);
    subscribeKiroSession(session, target, forkedId, this.publish);
    const normalizedTitle = title.trim().slice(0, 120) || metadata?.title || "Kiro 포크";
    await renameKiroSession(target, forkedId, normalizedTitle);
    sessionsAfter = await listKiroSessions(target);
    return {
      threadId: forkedId,
      title: normalizedTitle,
      cwd: forkCwd,
      model,
      effort,
      permissionProfile: session.policyPresetsByThread.get(forkedId)?.join(",") ?? null,
      skills,
      modes,
      currentModeId,
    };
  }
}

function timestampValue(value: string | number | null): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
