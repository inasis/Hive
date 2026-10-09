import type { TranscriptEntry } from "../../../domain/assistant.js";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderOpenThreadOptions, ProviderOpenThreadResult } from "../../../application/ports/provider-conversations.js";
import { kiroEffortOptions, kiroModes, loadKiroSkills, withKiroEffortOptions } from "./session-catalog-mapper.js";
import { subscribeKiroSession } from "./session-events.js";
import { collectKiroTranscript } from "./session-update-mapper.js";
import { listKiroSessions } from "./cli.js";
import { getKiroSessionPolicyPresets } from "../../persistence/kiro-session-metadata.js";
import { kiroPermissionProfileForPresets } from "./session-metadata.js";
import type { KiroSessionContext } from "./session-context.js";
import { asObject, firstString, type JsonObject } from "./session-utils.js";
import { createKiroA2AMcpServers } from "./a2a-mcp-server.js";
import { mapKiroPromptTranscriptEntries } from "./session-transcript-mapper.js";

/** Hydrate a Kiro provider session and its cached transcript, settings, modes, and skills. */
export async function loadKiroSessionThread(
  context: KiroSessionContext,
  publish: AssistantEventPublisher,
  target: string,
  threadId: string,
  options: ProviderOpenThreadOptions = { includeTranscript: true },
): Promise<ProviderOpenThreadResult> {
  const session = await context.getOrConnect(target);
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
  subscribeKiroSession(session, target, threadId, publish);
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
    entries: options.includeTranscript ? mapKiroPromptTranscriptEntries(replay) : [],
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
