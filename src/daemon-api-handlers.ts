import { execFile as execFileCallback } from "node:child_process";
import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";
import { assertSshTarget, LOCAL_CODEX_TARGET } from "./codex-rpc.js";
import { CodexAppServerApi, type CodexThread } from "./codex-api.js";
import { defaultOpenCodeModel, mapOpenCodeSession, mapOpenCodeTranscript, openCodeModelFromMessages, openCodeModelFromSession, OpenCodeProviderConnection, type OpenCodeBridgeEvent, type OpenCodeModel, type OpenCodeSkill } from "./opencode-provider.js";
import { ensureOpenCodeServer, stopManagedOpenCodeServer } from "./opencode-server.js";
import { secureRelayStream } from "./e2e-stream.js";
import { discoverSkills, readPiSkill, type AvailableSkill, type SkillCatalog } from "./skills.js";
import { connectHiveRelay, parseHiveRelayTarget } from "./tcp-relay.js";
import { listLocalWorkspaceFiles, readLocalWorkspaceFile, requestRelayWorkspaceFile, requestSshWorkspaceFile, requestSshWorkspaceWrite, writeLocalWorkspaceFile } from "./workspace-files.js";
import { ASSISTANT_PROVIDERS, DEFAULT_ASSISTANT_PROVIDER, isAssistantProvider, type AssistantProvider } from "./domain/provider-catalog.js";
import type { AssistantCommand as RemoteCommand, AssistantMode as RemoteMode, AssistantModel as RemoteModel, AssistantSkill as RemoteSkill, AssistantThread as RemoteThread, PromptImageAttachment as KiroPromptImage, ReasoningEffort as RemoteReasoningEffort, TranscriptEntry } from "./domain/assistant.js";
import { isDaemonApiMethod, isProviderDaemonApiMethod, type ProviderDaemonApiMethod, type SharedDaemonApiMethod } from "./daemon-api-contract.js";
import { deleteKiroSession, forgetKiroSessionAlias, forgetKiroSessionPolicyPresets, getKiroSessionPolicyPresets, isValidKiroSessionId, KiroAcpConnection, listKiroModels, listKiroSessions, listKiroSkills, renameKiroSession, saveKiroSessionPolicyPresets, type KiroNotification, type KiroServerRequest } from "./kiro-provider.js";
import { randomUUID } from "node:crypto";
type BridgeEvent = { target: string; threadId: string; method: string; params: unknown; provider?: AssistantProvider; requestId?: number | string };

const daemonEventListeners = new Set<(event: BridgeEvent) => void>();
const LOCAL_PROVIDER_TARGET = "hive-local://";
const execFile = promisify(execFileCallback);
export function subscribeDaemonEvents(listener: (event: BridgeEvent) => void): () => void {
  daemonEventListeners.add(listener);
  return () => daemonEventListeners.delete(listener);
}

type JsonObject = Record<string, unknown>;
type RemoteSession = {
  api: CodexAppServerApi;
  activeThreadId?: string;
  openedThreadIds: Set<string>;
  unsubscribe: () => void;
  skillsByThread: Map<string, SkillCatalog>;
  models: RemoteModel[];
  settingsByThread: Map<string, { model: string; effort: string | null; permissionProfile: string | null; collaborationMode?: "default" | "plan" }>;
};
type OpenCodeRemoteSession = {
  connection: OpenCodeProviderConnection;
  openedThreadIds: Set<string>;
  settingsByThread: Map<string, { model: string }>;
  modelsByThread: Map<string, OpenCodeModel[]>;
  cwdByThread: Map<string, string>;
  skillsByThread: Map<string, OpenCodeSkill[]>;
};
type KiroRemoteSession = {
  connection: KiroAcpConnection;
  openedThreadIds: Set<string>;
  settingsByThread: Map<string, { model: string; effort: string | null }>;
  cwdByThread: Map<string, string>;
  models: RemoteModel[];
  commandsByThread: Map<string, RemoteCommand[]>;
  skillsByThread: Map<string, RemoteSkill[]>;
  modesByThread: Map<string, RemoteMode[]>;
  currentModeByThread: Map<string, string>;
  policyPresetsByThread: Map<string, string[]>;
  transcriptsByThread: Map<string, TranscriptEntry[]>;
  activeTurnIds: Map<string, string>;
  pendingApprovals: Map<string, { threadId: string; options: JsonObject[] }>;
  terminalsById: Map<string, KiroAcpTerminal>;
  updateUnsubscribers: Map<string, () => void>;
};
type KiroAcpTerminal = {
  id: string;
  threadId: string;
  pty: IPty;
  output: Buffer;
  outputByteLimit: number;
  truncated: boolean;
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
  exitPromise: Promise<void>;
  resolveExit: () => void;
};
type TerminalSession = {
  target: string;
  sessionId: string;
  abort: AbortController;
  stopped: boolean;
  pty?: IPty;
  stream?: Duplex;
  receiveBuffer: Buffer;
};

const sessions = new Map<string, RemoteSession>();
const connecting = new Map<string, Promise<RemoteSession>>();
const openCodeSessions = new Map<string, OpenCodeRemoteSession>();
const openCodeConnecting = new Map<string, Promise<OpenCodeRemoteSession>>();
const kiroSessions = new Map<string, KiroRemoteSession>();
const kiroConnecting = new Map<string, Promise<KiroRemoteSession>>();
const terminals = new Map<string, TerminalSession>();
process.once("exit", () => {
  for (const session of kiroSessions.values()) {
    closeKiroAcpTerminals(session);
    session.connection.terminate();
  }
});
type DaemonRequestHandler = (params: any) => unknown;
const providerRequestHandlers: Record<ProviderDaemonApiMethod, DaemonRequestHandler> = {
  connect: async ({ target, provider }) => {
    if (provider === "opencode") {
      const session = await getOrConnectOpenCode(target);
      let modelWarning: string | undefined;
      if (!session.connection.models.some((model) => !model.hidden)) modelWarning = session.connection.modelWarning ?? "OpenCode에서 사용할 수 있는 모델을 찾지 못했습니다. OpenCode의 provider 설정과 인증을 확인하세요.";
      return { target, threads: (await session.connection.listSessions()).map((thread) => ({ ...mapOpenCodeSession(thread), provider: "opencode" as const })), models: session.connection.models, ...(modelWarning ? { modelWarning } : {}) };
    }
    if (provider === "kiro") {
      const session = await getOrConnectKiro(target);
      let modelWarning: string | undefined;
      if (!session.models.length) {
        try {
          session.models = await listKiroModels(target);
        } catch (error) {
          modelWarning = errorMessage(error);
        }
      }
      return {
        target,
        threads: (await listKiroSessions(target)).map((thread) => ({ ...thread, provider: "kiro" as const })),
        models: session.models,
        ...(modelWarning ? { modelWarning } : {}),
      };
    }
    const session = await getOrConnect(target);
    let modelWarning: string | undefined;
    if (session.models.length === 0) {
      try {
        session.models = await session.api.listModels();
      } catch (error) {
        modelWarning = errorMessage(error);
      }
    }
    return {
      target,
      threads: await listThreads(session.api),
      models: session.models,
      ...(modelWarning ? { modelWarning } : {}),
    };
  },
  refresh: async ({ target, provider }) => {
    if (provider === "opencode") return { threads: (await requireOpenCodeSession(target).connection.listSessions()).map((thread) => ({ ...mapOpenCodeSession(thread), provider: "opencode" as const })) };
    if (provider === "kiro") return { threads: (await listKiroSessions(target)).map((thread) => ({ ...thread, provider: "kiro" as const })) };
    const session = await getOrConnect(target);
    return { threads: await listThreads(session.api) };
  },
  renameThread: async ({ target, threadId, name, provider }) => {
    validateThreadId(threadId);
    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName) throw new Error("Session name cannot be empty");
    if (normalizedName.length > 120) throw new Error("Session name cannot exceed 120 characters");
    if (provider === "opencode") {
      await requireOpenCodeSession(target).connection.renameSession(threadId, normalizedName);
      return { renamed: true as const };
    }
    if (provider === "kiro") {
      await renameKiroSession(target, threadId, normalizedName);
      return { renamed: true as const };
    }
    const session = await getOrConnect(target);
    await session.api.setThreadName(threadId, normalizedName);
    return { renamed: true as const };
  },
  deleteThread: async ({ target, threadId, provider }) => {
    validateThreadId(threadId);
    if (provider === "opencode") {
      const session = requireOpenCodeSession(target);
      await deleteOpenCodeSession(session.connection, threadId);
      session.openedThreadIds.delete(threadId);
      session.settingsByThread.delete(threadId);
      session.modelsByThread.delete(threadId);
      session.cwdByThread.delete(threadId);
      session.skillsByThread.delete(threadId);
      return { deleted: true as const };
    }
    if (provider === "kiro") {
      const session = kiroSessions.get(target);
      await deleteKiroSession(target, threadId);
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
      return { deleted: true as const };
    }
    const session = await getOrConnect(target);
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
    return { deleted: true as const };
  },
  createThread: async ({ target, cwd, provider, permissionPresets, name }) => {
    const workspacePath = cwd.trim();
    if (!workspacePath) throw new Error("Choose a remote workspace path before creating a session");
    if (provider === "opencode") {
      const session = requireOpenCodeSession(target);
      const catalog = await session.connection.listModels(workspacePath);
      const model = defaultOpenCodeModel(catalog.models);
      if (!model) throw new Error(catalog.modelWarning ?? "OpenCode 모델을 찾지 못해 세션을 만들 수 없습니다. 먼저 사용 가능한 모델을 연결하세요.");
      const created = await session.connection.createSession(workspacePath, undefined, model);
      const threadId = created.id;
      const mapped = mapOpenCodeSession(created);
      session.openedThreadIds.add(threadId);
      session.cwdByThread.set(threadId, mapped.cwd || workspacePath);
      session.settingsByThread.set(threadId, { model });
      session.modelsByThread.set(threadId, catalog.models);
      const skillCatalog = await loadOpenCodeSkills(session, threadId, mapped.cwd || workspacePath);
      const thread = { ...mapped, cwd: mapped.cwd || workspacePath, provider: "opencode" as const };
      return { thread, threadId, title: thread.title, cwd: thread.cwd, entries: [], skills: skillCatalog.skills.map(toRemoteOpenCodeSkill), skillWarnings: skillCatalog.warnings, models: catalog.models, ...(catalog.modelWarning ? { modelWarning: catalog.modelWarning } : {}), model, reasoningEffort: null, permissionProfile: null };
    }
    if (provider === "kiro") {
      const session = await getOrConnectKiro(target);
      const selectedPresets = validateKiroPresets(permissionPresets);
      const created = await session.connection.newSession(workspacePath, selectedPresets);
      const threadId = firstString(created.sessionId, created.id);
      if (!threadId || !isValidKiroSessionId(threadId)) throw new Error("Kiro returned an invalid session/new response");
      const model = session.models.find((candidate) => candidate.isDefault)?.model ?? "auto";
      const title = typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : "Kiro 세션";
      if (title !== "Kiro 세션") await renameKiroSession(target, threadId, title);
      await saveKiroSessionPolicyPresets(target, threadId, selectedPresets);
      session.openedThreadIds.add(threadId);
      session.cwdByThread.set(threadId, workspacePath);
      session.settingsByThread.set(threadId, { model, effort: null });
      session.policyPresetsByThread.set(threadId, selectedPresets);
      session.transcriptsByThread.set(threadId, []);
      const modes = kiroModes(created);
      if (modes.length) session.modesByThread.set(threadId, modes);
      const currentModeId = firstString(asObject(created.modes)?.currentModeId);
      if (currentModeId) session.currentModeByThread.set(threadId, currentModeId);
      subscribeKiroSession(session, target, threadId);
      const skills = await loadKiroSkills(session, target, threadId, workspacePath);
      const effortOptions = await kiroEffortOptions(session, threadId);
      if (effortOptions.current) session.settingsByThread.set(threadId, { model, effort: effortOptions.current });
      session.models = withKiroEffortOptions(session.models, model, effortOptions.options);
      return {
        thread: { id: threadId, title, cwd: workspacePath, preview: "", updatedAt: Date.now(), provider: "kiro" as const },
        threadId,
        title,
        cwd: workspacePath,
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
    const session = await getOrConnect(target);
    const started = asObject(await session.api.startThread(workspacePath));
    const thread = asObject(started?.thread);
    const threadId = firstString(thread?.id);
    if (!started || !thread || !threadId) throw new Error("Codex returned an invalid thread/start response");

    const actualCwd = firstString(started.cwd, thread.cwd, workspacePath) ?? workspacePath;
    const title = firstString(thread.name, thread.title, thread.preview) ?? "새 세션";
    const model = firstString(started.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(started.reasoningEffort) ?? null;
    const permissionProfile = firstString(asObject(started.activePermissionProfile)?.id) ?? null;
    session.activeThreadId = threadId;
    session.openedThreadIds.add(threadId);
    session.settingsByThread.set(threadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode: "default" });
    const catalog = await discoverSkills(session.api, target, actualCwd || undefined);
    session.skillsByThread.set(threadId, catalog);
    return {
      thread: {
        id: threadId,
        title,
        cwd: actualCwd,
        preview: "",
        updatedAt: Date.now(),
        provider: "codex" as const,
      },
      threadId,
      title,
      cwd: actualCwd,
      entries: [],
      skills: catalog.skills.map(toRemoteSkill),
      skillWarnings: catalog.warnings,
      model,
      reasoningEffort,
      permissionProfile,
    };
  },
  openThread: async ({ target, threadId, provider }) => {
    validateThreadId(threadId);
    if (provider === "opencode") {
      const session = requireOpenCodeSession(target);
      const [thread, messages] = await Promise.all([session.connection.getSession(threadId), session.connection.listMessages(threadId)]);
      const mapped = mapOpenCodeSession(thread);
      const catalog = await session.connection.listModels(mapped.cwd || undefined);
      const skillCatalog = await loadOpenCodeSkills(session, threadId, mapped.cwd);
      const model = session.settingsByThread.get(threadId)?.model ?? openCodeModelFromSession(thread) ?? openCodeModelFromMessages(messages) ?? defaultOpenCodeModel(catalog.models) ?? "";
      session.openedThreadIds.add(threadId);
      session.cwdByThread.set(threadId, mapped.cwd);
      session.settingsByThread.set(threadId, { model });
      session.modelsByThread.set(threadId, catalog.models);
      return { target, threadId, title: mapped.title, cwd: mapped.cwd, entries: mapOpenCodeTranscript(messages), skills: skillCatalog.skills.map(toRemoteOpenCodeSkill), skillWarnings: skillCatalog.warnings, models: catalog.models, ...(catalog.modelWarning ? { modelWarning: catalog.modelWarning } : {}), model, reasoningEffort: null, permissionProfile: null };
    }
    if (provider === "kiro") {
      const session = await getOrConnectKiro(target);
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
      subscribeKiroSession(session, target, threadId);
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
    const session = await getOrConnect(target);
    const threadRead = await session.api.readThread(threadId);
    const thread = asObject(threadRead.thread);
    if (!thread) throw new Error("Codex returned an invalid thread/read response");

    const resumed = await session.api.resumeThread(threadId, { excludeTurns: true });
    const resumedThread = asObject(asObject(resumed)?.thread);
    if (!resumedThread) throw new Error("Codex returned an invalid thread/resume response");

    const cwd = firstString(resumedThread.cwd, thread.cwd) ?? "";
    const model = firstString(asObject(resumed)?.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(asObject(resumed)?.reasoningEffort) ?? null;
    const permissionProfile = firstString(asObject(asObject(resumed)?.activePermissionProfile)?.id) ?? null;
    session.activeThreadId = threadId;
    session.openedThreadIds.add(threadId);
    const collaborationMode = firstString(asObject(asObject(resumed)?.collaborationMode)?.mode) === "plan" ? "plan" : "default";
    session.settingsByThread.set(threadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode });
    const catalog = await discoverSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(threadId, catalog);
    return {
      target,
      threadId,
      title: firstString(resumedThread.name, resumedThread.title, thread.name, thread.title, thread.preview) ?? threadId,
      cwd,
      entries: transcriptEntries(thread),
      skills: catalog.skills.map(toRemoteSkill),
      skillWarnings: catalog.warnings,
      model,
      reasoningEffort,
      permissionProfile,
    };
  },
  forkSideThread: async ({ target, threadId, provider }) => {
    validateThreadId(threadId);
    if (provider === "opencode") {
      const session = requireOpenCodeSession(target);
      const forked = await session.connection.forkSession(threadId);
      const forkedId = forked.id;
      const mapped = mapOpenCodeSession(forked);
      const catalog = await session.connection.listModels(mapped.cwd || undefined);
      const model = session.settingsByThread.get(threadId)?.model ?? openCodeModelFromSession(forked) ?? defaultOpenCodeModel(catalog.models) ?? "";
      const skillCatalog = await loadOpenCodeSkills(session, forkedId, mapped.cwd);
      session.openedThreadIds.add(forkedId);
      session.cwdByThread.set(forkedId, mapped.cwd);
      session.settingsByThread.set(forkedId, { model });
      session.modelsByThread.set(forkedId, catalog.models);
      return { target, threadId: forkedId, title: mapped.title, cwd: mapped.cwd, skills: skillCatalog.skills.map(toRemoteOpenCodeSkill), skillWarnings: skillCatalog.warnings, models: catalog.models, ...(catalog.modelWarning ? { modelWarning: catalog.modelWarning } : {}), model, reasoningEffort: null, permissionProfile: null };
    }
    if (provider === "kiro") {
      const session = requireKiroSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before creating a side conversation");
      const parent = (session.transcriptsByThread.get(threadId) ?? []).filter((entry) => entry.role === "assistant" && entry.responseCompleted !== false).at(-1);
      const forked = await forkKiroConversation(session, target, threadId, parent?.turnId, "사이드 채팅");
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
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) {
      throw new Error("Open this Codex session before creating a side conversation");
    }
    const forked = asObject(await session.api.forkThread(threadId, { ephemeral: true, excludeTurns: true }));
    const forkedThread = asObject(forked?.thread);
    const sideThreadId = firstString(forkedThread?.id);
    if (!forked || !forkedThread || !sideThreadId) throw new Error("Codex returned an invalid thread/fork response");

    const cwd = firstString(forked.cwd, forkedThread.cwd) ?? "";
    const parentSettings = session.settingsByThread.get(threadId);
    const model = firstString(forked.model) ?? parentSettings?.model ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(forked.reasoningEffort) ?? parentSettings?.effort ?? null;
    const permissionProfile = firstString(asObject(forked.activePermissionProfile)?.id) ?? parentSettings?.permissionProfile ?? null;
    session.activeThreadId = sideThreadId;
    session.openedThreadIds.add(sideThreadId);
    session.settingsByThread.set(sideThreadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode: parentSettings?.collaborationMode ?? "default" });
    const catalog = session.skillsByThread.get(threadId) ?? await discoverSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(sideThreadId, catalog);
    return {
      target,
      threadId: sideThreadId,
      title: "사이드 채팅",
      cwd,
      skills: catalog.skills.map(toRemoteSkill),
      skillWarnings: catalog.warnings,
      model,
      reasoningEffort,
      permissionProfile,
    };
  },
  forkThread: async ({ target, threadId, provider, turnId, messageId, name }) => {
    validateThreadId(threadId);
    const forkName = typeof name === "string" ? name.trim().slice(0, 120) : "";
    if (!forkName) throw new Error("Fork session name cannot be empty");
    if (provider === "opencode") {
      if (!messageId) throw new Error("OpenCode fork requires a completed assistant message");
      const session = requireOpenCodeSession(target);
      const forked = await session.connection.forkSession(threadId, messageId);
      const forkedId = forked.id;
      let renamed = false;
      try {
        await session.connection.renameSession(forkedId, forkName);
        renamed = true;
      } catch {}
      const mapped = mapOpenCodeSession(forked);
      const catalog = await session.connection.listModels(mapped.cwd || undefined);
      const model = session.settingsByThread.get(threadId)?.model ?? openCodeModelFromSession(forked) ?? defaultOpenCodeModel(catalog.models) ?? "";
      await loadOpenCodeSkills(session, forkedId, mapped.cwd);
      session.openedThreadIds.add(forkedId);
      session.cwdByThread.set(forkedId, mapped.cwd);
      session.settingsByThread.set(forkedId, { model });
      session.modelsByThread.set(forkedId, catalog.models);
      return { target, threadId: forkedId, title: renamed ? forkName : mapped.title, cwd: mapped.cwd, preview: "", updatedAt: Date.now(), provider: "opencode" as const };
    }
    if (provider === "kiro") {
      if (!messageId && !turnId) throw new Error("Kiro rewind requires the selected completed response");
      const session = requireKiroSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before creating a fork");
      const forked = await forkKiroConversation(session, target, threadId, turnId, forkName);
      return {
        target,
        threadId: forked.threadId,
        title: forked.title,
        cwd: forked.cwd,
        preview: "",
        updatedAt: Date.now(),
        provider: "kiro" as const,
      };
    }
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before creating a fork");
    let forkTurnId = turnId;
    if (!forkTurnId && messageId) {
      const source = asObject((await session.api.readThread(threadId)).thread);
      const turns = Array.isArray(source?.turns) ? source.turns : [];
      const containingTurn = turns.find((turnValue) => {
        const turn = asObject(turnValue);
        const items = Array.isArray(turn?.items) ? turn.items : [];
        return items.some((itemValue) => firstString(asObject(itemValue)?.id) === messageId);
      });
      forkTurnId = firstString(asObject(containingTurn)?.id);
    }
    if (!forkTurnId) throw new Error("Codex could not resolve the selected response to a completed turn");
    const forked = asObject(await session.api.forkThread(threadId, { lastTurnId: forkTurnId, ephemeral: false }));
    const forkedThread = asObject(forked?.thread);
    const forkedId = firstString(forkedThread?.id);
    if (!forked || !forkedThread || !forkedId) throw new Error("Codex returned an invalid thread/fork response");
    let renamed = false;
    try {
      await session.api.setThreadName(forkedId, forkName);
      renamed = true;
    } catch {}
    const cwd = firstString(forked.cwd, forkedThread.cwd) ?? "";
    const parentSettings = session.settingsByThread.get(threadId);
    const model = firstString(forked.model) ?? parentSettings?.model ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(forked.reasoningEffort) ?? parentSettings?.effort ?? null;
    const permissionProfile = firstString(asObject(forked.activePermissionProfile)?.id) ?? parentSettings?.permissionProfile ?? null;
    session.openedThreadIds.add(forkedId);
    session.settingsByThread.set(forkedId, { model, effort: reasoningEffort, permissionProfile, collaborationMode: parentSettings?.collaborationMode ?? "default" });
    const catalog = session.skillsByThread.get(threadId) ?? await discoverSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(forkedId, catalog);
    return { target, threadId: forkedId, title: renamed ? forkName : firstString(forkedThread.name, forkedThread.title) ?? forkName, cwd, preview: "", updatedAt: Date.now(), provider: "codex" as const };
  },
  listSkills: async ({ target, threadId, cwd, provider }) => {
    validateThreadId(threadId);
    if (provider === "opencode") {
      const session = requireOpenCodeSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before listing its skills");
      const directory = firstString(cwd, session.cwdByThread.get(threadId));
      const catalog = await loadOpenCodeSkills(session, threadId, directory);
      return { skills: catalog.skills.map(toRemoteOpenCodeSkill), warnings: catalog.warnings };
    }
    if (provider === "kiro") {
      const session = requireKiroSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before listing its skills");
      const skills = await loadKiroSkills(session, target, threadId, firstString(cwd, session.cwdByThread.get(threadId)) ?? "");
      return { skills, warnings: [] };
    }
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before listing its skills");
    const catalog = await discoverSkills(session.api, target, firstString(cwd));
    session.skillsByThread.set(threadId, catalog);
    return { skills: catalog.skills.map(toRemoteSkill), warnings: catalog.warnings };
  },
  listCommands: async ({ target, threadId, cwd, provider }) => {
    validateThreadId(threadId);
    if (provider === "opencode") {
      const session = requireOpenCodeSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before listing its commands");
      try {
        const directory = firstString(cwd, session.cwdByThread.get(threadId));
        const commands = await session.connection.listCommands(directory);
        return { commands: commands.map((command) => ({ ...command, provider: "OpenCode", takesArguments: true })), warnings: [] };
      } catch (error) {
        return { commands: [], warnings: [`OpenCode 명령 목록을 가져오지 못했습니다: ${errorMessage(error)}`] };
      }
    }
    if (provider === "kiro") {
      const session = requireKiroSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before listing its commands");
      return { commands: listKiroCommands(session, threadId), warnings: [] };
    }
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before listing its commands");
    const commands: RemoteCommand[] = [];
    const warnings: string[] = [];
    try {
      const result = asObject(await session.api.listCollaborationModes());
      const presets = Array.isArray(result?.data) ? result.data : [];
      if (presets.some((preset) => firstString(asObject(preset)?.mode) === "plan")) {
        commands.push({ name: "plan", description: "계획 모드를 켜거나 끕니다.", provider: "Codex", takesArguments: false });
      }
    } catch (error) {
      warnings.push(`Codex 모드 명령을 가져오지 못했습니다: ${errorMessage(error)}`);
    }
    try {
      await session.api.getThreadGoal(threadId);
      commands.push({ name: "goal", description: "현재 목표를 확인하거나 설정·일시 중지·재개·삭제합니다.", provider: "Codex", takesArguments: true });
    } catch {
      // Older Codex app-server versions do not expose the native Goal API.
    }
    return { commands, warnings };
  },
  runCommand: async ({ target, threadId, command, arguments: commandArguments = "", cwd, provider }) => {
    validateThreadId(threadId);
    const name = command.trim().replace(/^\/+/, "");
    if (!/^[A-Za-z0-9._/-]{1,128}$/.test(name)) throw new Error("Invalid slash command name");
    if (provider === "opencode") {
      const session = requireOpenCodeSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before running its commands");
      const directory = firstString(cwd, session.cwdByThread.get(threadId));
      const available = await session.connection.listCommands(directory);
      if (!available.some((candidate) => candidate.name === name)) throw new Error(`OpenCode 명령 /${name}을(를) 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.`);
      const turnId = await session.connection.sendPrompt(target, threadId, `/${name}${commandArguments ? ` ${commandArguments}` : ""}`, session.settingsByThread.get(threadId)?.model ?? "", publishOpenCodeBridgeEvent, { name, arguments: commandArguments });
      return { executed: true as const, turnId };
    }
    if (provider === "kiro") {
      const session = requireKiroSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before running its commands");
      const available = listKiroCommands(session, threadId);
      if (!available.some((candidate) => candidate.name === name)) {
        throw new Error(`Kiro에서 /${name} 명령을 찾지 못했습니다. / 메뉴를 새로고침하고 다시 선택하세요.`);
      }
      if (name === "rewind") {
        const requestedIndex = Number(commandArguments.trim());
        const userEntries = (session.transcriptsByThread.get(threadId) ?? []).filter((entry) => entry.role === "user");
        if (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > userEntries.length) {
          throw new Error(`/rewind에는 1부터 ${userEntries.length} 사이의 최근 프롬프트 번호를 입력하세요.`);
        }
        const selected = userEntries.at(-requestedIndex);
        const parentTitle = (await listKiroSessions(target)).find((item) => item.id === threadId)?.title ?? "대화";
        const forked = await forkKiroConversation(session, target, threadId, selected?.turnId, `${parentTitle} · 되감기`);
        return {
          executed: true as const,
          message: "선택한 대화 시점에서 새 Kiro 세션을 만들었습니다.",
          thread: { id: forked.threadId, title: forked.title, cwd: forked.cwd, preview: "", updatedAt: Date.now(), provider: "kiro" as const },
        };
      }
      const args = kiroCommandArguments(name, commandArguments);
      const result = await session.connection.executeCommand(threadId, name, args);
      if (result.success === false) throw new Error(firstString(result.message) ?? `Kiro /${name} 명령을 실행하지 못했습니다.`);
      const data = asObject(result.data);
      if (name === "clear") {
        session.transcriptsByThread.set(threadId, []);
        publishBridgeEvent({ target, threadId, provider: "kiro", method: "thread/transcript/cleared", params: { threadId } });
      }
      const model = firstString(asObject(data?.model)?.id, asObject(data?.model)?.modelId, data?.modelId);
      if (model) {
        const current = session.settingsByThread.get(threadId);
        session.settingsByThread.set(threadId, { model, effort: current?.effort ?? null });
        const effortOptions = await kiroEffortOptions(session, threadId);
        session.models = withKiroEffortOptions(session.models, model, effortOptions.options);
      }
      const effort = firstString(data?.effort, asObject(data?.effort)?.value);
      if (effort) {
        const current = session.settingsByThread.get(threadId);
        session.settingsByThread.set(threadId, { model: current?.model ?? "", effort });
      }
      const modeId = firstString(data?.currentModeId, data?.modeId, asObject(data?.mode)?.id);
      if (modeId) {
        session.currentModeByThread.set(threadId, modeId);
        publishBridgeEvent({ target, threadId, provider: "kiro", method: "thread/settings/updated", params: { threadId, threadSettings: { currentModeId: modeId } } });
      }
      if (model || effort) {
        const current = session.settingsByThread.get(threadId);
        const modelEfforts = current ? session.models.find((candidate) => candidate.model === current.model)?.supportedReasoningEfforts : undefined;
        publishBridgeEvent({ target, threadId, provider: "kiro", method: "thread/settings/updated", params: {
          threadId,
          threadSettings: { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(modelEfforts ? { supportedReasoningEfforts: modelEfforts } : {}) },
        } });
        if (current) session.settingsByThread.set(threadId, current);
      }
      return { executed: true as const, ...(firstString(result.message) ? { message: firstString(result.message) } : {}) };
    }
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before running its commands");
    if (name === "plan") {
      if (commandArguments.trim()) throw new Error("/plan 명령은 인자를 받지 않습니다.");
      const response = asObject(await session.api.listCollaborationModes());
      const presets = (Array.isArray(response?.data) ? response.data : []).map(asObject).filter((preset): preset is JsonObject => Boolean(preset));
      const current = session.settingsByThread.get(threadId);
      const currentMode = current?.collaborationMode ?? "default";
      const nextMode = currentMode === "plan" ? "default" : "plan";
      const preset = presets.find((item) => item.mode === nextMode) ??
        (nextMode === "default" ? { mode: "default", model: current?.model, reasoning_effort: null } : undefined);
      if (!preset) throw new Error(`Codex에서 ${nextMode === "plan" ? "Plan" : "기본"} 모드를 사용할 수 없습니다.`);
      const model = firstString(preset.model, current?.model) ?? "";
      const effort = typeof preset.reasoning_effort === "string"
        ? preset.reasoning_effort
        : preset.reasoning_effort === null ? null : current?.effort ?? null;
      await session.api.updateThreadSettings(threadId, {
        collaborationMode: { mode: nextMode, settings: { model, reasoning_effort: effort, developer_instructions: null } },
      });
      session.settingsByThread.set(threadId, { model, effort, permissionProfile: current?.permissionProfile ?? null, collaborationMode: nextMode });
      return { executed: true as const, message: `${nextMode === "plan" ? "Plan" : "기본 실행"} 모드를 사용합니다.` };
    }
    if (name !== "goal") throw new Error(`Codex에서 /${name} 명령을 지원하지 않습니다.`);
    const available = await session.api.getThreadGoal(threadId);
    const existingGoal = asObject(asObject(available)?.goal);
    const argument = commandArguments.trim();
    if (!argument) {
      return { executed: true as const, message: existingGoal
        ? `현재 목표 (${firstString(existingGoal.status) ?? "상태 없음"}): ${firstString(existingGoal.objective) ?? ""}`
        : "이 세션에는 설정된 목표가 없습니다. /goal <목표> 형식으로 설정하세요." };
    }
    if (argument === "clear") {
      if (!existingGoal) return { executed: true as const, message: "삭제할 목표가 없습니다." };
      await session.api.clearThreadGoal(threadId);
      return { executed: true as const, message: "세션 목표를 삭제했습니다." };
    }
    if (argument === "pause" || argument === "resume") {
      if (!existingGoal) throw new Error("일시 중지하거나 재개할 목표가 없습니다.");
      const status = argument === "pause" ? "paused" : "active";
      await session.api.setThreadGoal(threadId, { status });
      return { executed: true as const, message: `세션 목표를 ${argument === "pause" ? "일시 중지" : "재개"}했습니다.` };
    }
    const objective = argument.startsWith("set ") ? argument.slice(4).trim() : argument;
    if (!objective) throw new Error("목표 내용을 입력하세요: /goal <목표>");
    await session.api.setThreadGoal(threadId, { objective });
    return { executed: true as const, message: `세션 목표를 설정했습니다: ${objective}` };
  },
  sendPrompt: async ({ target, threadId, text, skillId, cwd, images, provider }) => {
    if (!text.trim() && !(provider === "kiro" && Array.isArray(images) && images.length)) throw new Error("Message cannot be empty");
    validateThreadId(threadId);
    if (provider === "opencode") {
      const session = requireOpenCodeSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before sending a message");
      let inputText = text;
      if (skillId) {
        const directory = firstString(cwd, session.cwdByThread.get(threadId));
        const catalog = await loadOpenCodeSkills(session, threadId, directory);
        const skill = catalog.skills.find((candidate) => candidate.id === skillId);
        if (!skill) throw new Error("선택한 OpenCode 스킬을 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.");
        inputText = buildOpenCodeSkillInput(skill, text);
      }
      const turnId = await session.connection.sendPrompt(target, threadId, inputText, session.settingsByThread.get(threadId)?.model ?? "", publishOpenCodeBridgeEvent);
      return { accepted: true as const, turnId };
    }
    if (provider === "kiro") {
      const session = requireKiroSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before sending a message");
      if (session.activeTurnIds.has(threadId)) throw new Error("Kiro is already working in this session.");
      const promptImages = validateKiroPromptImages(images);
      if (!text.trim() && !promptImages.length) throw new Error("Message cannot be empty");
      let promptText = text.trim() || "첨부한 이미지를 확인해 주세요.";
      if (skillId) {
        const skill = (session.skillsByThread.get(threadId) ?? []).find((candidate) => candidate.id === skillId);
        if (!skill) throw new Error("선택한 Kiro 스킬을 찾지 못했습니다. 스킬 목록을 새로고침하세요.");
        promptText = `Use the Kiro skill named "${skill.name}" for this request.\n\n${text}`;
      }
      if (promptImages.length) promptText += `\n\n[첨부 이미지: ${promptImages.map((image) => image.name).join(", ")}]`;
      const turnId = randomUUID();
      const transcript = session.transcriptsByThread.get(threadId) ?? [];
      transcript.push({ id: `kiro-user-${turnId}`, role: "user", text: promptText, turnId });
      session.transcriptsByThread.set(threadId, transcript);
      session.activeTurnIds.set(threadId, turnId);
      publishBridgeEvent({ target, threadId, provider: "kiro", method: "turn/started", params: { threadId, turn: { id: turnId } } });
      const promptContent: JsonObject[] = [
        { type: "text", text: promptText },
        ...promptImages.map((image) => ({ type: "image", mimeType: image.mimeType, data: image.data })),
      ];
      session.connection.startPrompt(threadId, promptContent, (error) => {
        if (session.activeTurnIds.get(threadId) !== turnId) return;
        session.activeTurnIds.delete(threadId);
        for (const entry of session.transcriptsByThread.get(threadId) ?? []) {
          if (entry.role === "assistant" && entry.turnId === turnId) {
            entry.responseCompleted = true;
            entry.status = "completed";
          }
        }
        publishBridgeEvent({
          target,
          threadId,
          provider: "kiro",
          method: "turn/completed",
          params: { threadId, turn: { id: turnId, ...(error ? { error: { message: errorMessage(error) } } : {}) } },
        });
      });
      return { accepted: true as const, turnId };
    }
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) {
      throw new Error("Open this Codex session before sending a message");
    }
    let catalog = session.skillsByThread.get(threadId);
    let inputText: string;
    if (skillId) {
    catalog = await discoverSkills(session.api, target, firstString(cwd));
      session.skillsByThread.set(threadId, catalog);
      const skill = catalog.skills.find((candidate) => toRemoteSkill(candidate).id === skillId);
      if (!skill) throw new Error("선택한 스킬을 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.");
      inputText = await buildSkillInput(target, skill, text);
    } else {
      inputText = await buildPrompt(target, threadId, text, catalog);
    }
    const started = asObject(await session.api.startTurn(threadId, inputText));
    const turnId = firstString(asObject(started?.turn)?.id);
    return { accepted: true as const, ...(turnId ? { turnId } : {}) };
  },
  steerTurn: async ({ target, threadId, turnId, text, skillId, cwd, provider }) => {
    if (!text.trim()) throw new Error("Message cannot be empty");
    validateThreadId(threadId);
    if (typeof turnId !== "string" || !turnId.trim() || turnId.length > 128) throw new Error("Invalid turn ID");
    if (provider === "opencode") throw new Error("OpenCode는 생성 중인 응답에 메시지를 끼워 넣을 수 없습니다. 현재 응답을 중지한 뒤 다시 보내세요.");
    if (provider === "kiro") throw new Error("Kiro ACP does not support adding a message to a running response.");
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before steering its turn");
    let catalog = session.skillsByThread.get(threadId);
    let inputText: string;
    if (skillId) {
    catalog = await discoverSkills(session.api, target, firstString(cwd));
      session.skillsByThread.set(threadId, catalog);
      const skill = catalog.skills.find((candidate) => toRemoteSkill(candidate).id === skillId);
      if (!skill) throw new Error("선택한 스킬을 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.");
      inputText = await buildSkillInput(target, skill, text);
    } else {
      inputText = await buildPrompt(target, threadId, text, catalog);
    }
    const result = asObject(await session.api.steerTurn(threadId, turnId, inputText));
    const acceptedTurnId = firstString(result?.turnId);
    return { steered: true as const, ...(acceptedTurnId ? { turnId: acceptedTurnId } : {}) };
  },
  interruptTurn: async ({ target, threadId, turnId, provider }) => {
    validateThreadId(threadId);
    if (typeof turnId !== "string" || !turnId.trim() || turnId.length > 128) throw new Error("Invalid turn ID");
    if (provider === "opencode") {
      await requireOpenCodeSession(target).connection.abortSession(target, threadId, publishOpenCodeBridgeEvent);
      return { interrupted: true as const };
    }
    if (provider === "kiro") {
      const session = requireKiroSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before interrupting its turn");
      const activeTurnId = session.activeTurnIds.get(threadId);
      if (!activeTurnId || activeTurnId !== turnId) throw new Error("Kiro turn is no longer active");
      session.connection.cancel(threadId);
      return { interrupted: true as const };
    }
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before interrupting its turn");
    await session.api.interruptTurn(threadId, turnId);
    return { interrupted: true as const };
  },
  updateThreadSettings: async ({ target, threadId, model, effort, permissionProfile, modeId, provider }) => {
    validateThreadId(threadId);
    if (provider === "opencode") {
      if (effort || permissionProfile) throw new Error("OpenCode does not expose Codex Thinking or permission profile settings.");
      const session = requireOpenCodeSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before changing its settings");
      if (!model) throw new Error("Select an OpenCode model to update");
      const availableModels = session.modelsByThread.get(threadId) ?? session.connection.models;
      if (!availableModels.some((candidate) => candidate.model === model && !candidate.hidden)) throw new Error("The selected model is not in the OpenCode model list for this workspace");
      await session.connection.setSessionModel(threadId, model);
      session.settingsByThread.set(threadId, { model });
      return { updated: true as const, model };
    }
    if (provider === "kiro") {
      if (permissionProfile) throw new Error("Kiro permission presets are selected when creating a session and cannot be reduced later.");
      const session = requireKiroSession(target);
      if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before changing its settings");
      const current = session.settingsByThread.get(threadId) ?? { model: "", effort: null };
      let selectedModel = current.model;
      let selectedEffort = current.effort;
      let supportedReasoningEfforts: RemoteReasoningEffort[] | undefined;
      if (model) {
        if (!session.models.some((candidate) => candidate.model === model && !candidate.hidden)) throw new Error("The selected model is not in the Kiro model list");
        await session.connection.setModel(threadId, model);
        selectedModel = model;
        const effortOptions = await kiroEffortOptions(session, threadId);
        selectedEffort = effortOptions.current ?? null;
        supportedReasoningEfforts = effortOptions.options;
        session.models = withKiroEffortOptions(session.models, model, effortOptions.options);
      }
      if (effort) {
        const options = supportedReasoningEfforts ?? session.models.find((candidate) => candidate.model === selectedModel)?.supportedReasoningEfforts ?? [];
        if (!options.some((candidate) => candidate.reasoningEffort === effort)) throw new Error(`${effort} is not supported by the selected Kiro model`);
        const result = await session.connection.executeCommand(threadId, "effort", { value: effort });
        if (result.success === false) throw new Error(firstString(result.message) ?? `Kiro Thinking 수준을 ${effort}(으)로 바꾸지 못했습니다.`);
        selectedEffort = effort;
      }
      let selectedModeId = session.currentModeByThread.get(threadId);
      if (modeId) {
        if (!session.modesByThread.get(threadId)?.some((candidate) => candidate.id === modeId)) throw new Error("The selected Kiro agent mode is not available in this session");
        await session.connection.setMode(threadId, modeId);
        selectedModeId = modeId;
        session.currentModeByThread.set(threadId, modeId);
      }
      if (!model && !effort && !modeId) throw new Error("Select a Kiro model, Thinking level, or agent mode to update");
      session.settingsByThread.set(threadId, { model: selectedModel, effort: selectedEffort });
      return {
        updated: true as const,
        ...(model ? { model: selectedModel } : {}),
        ...(effort ? { effort: selectedEffort ?? effort } : model && selectedEffort ? { effort: selectedEffort } : {}),
        ...(modeId && selectedModeId ? { currentModeId: selectedModeId } : {}),
        ...(supportedReasoningEfforts ? { supportedReasoningEfforts } : {}),
      };
    }
    const session = await getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before changing its settings");
    const current = session.settingsByThread.get(threadId);
    const selectedModel = model ?? current?.model;
    const modelInfo = selectedModel ? session.models.find((candidate) => candidate.model === selectedModel) : undefined;
    if (model && !modelInfo) throw new Error("The selected model is not in the remote Codex model list");
    if (effort && modelInfo && !modelInfo.supportedReasoningEfforts.some((candidate) => candidate.reasoningEffort === effort)) {
      throw new Error(`${effort} is not supported by ${modelInfo.displayName}`);
    }
    if (permissionProfile && ![":read-only", ":workspace", ":danger-full-access"].includes(permissionProfile)) {
      throw new Error("The selected permission profile is not supported");
    }
    if (!model && !effort && !permissionProfile) throw new Error("Select a model, Thinking level, or permission profile to update");
    await session.api.updateThreadSettings(threadId, {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(permissionProfile ? {
        permissions: permissionProfile,
        approvalPolicy: permissionProfile === ":danger-full-access" ? "never" : "on-request",
      } : {}),
    });
    session.settingsByThread.set(threadId, {
      model: selectedModel ?? "",
      effort: effort ?? current?.effort ?? null,
      permissionProfile: permissionProfile ?? current?.permissionProfile ?? null,
      collaborationMode: current?.collaborationMode ?? "default",
    });
    return { updated: true as const, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(permissionProfile ? { permissionProfile } : {}) };
  },
  disconnect: async ({ target, provider }) => {
    for (const terminal of [...terminals.values()]) {
      if (terminal.target === target) stopTerminal(target, terminal.sessionId);
    }
    if (provider === "opencode") {
      const session = openCodeSessions.get(target);
      if (session) {
        openCodeSessions.delete(target);
        session.connection.close();
      }
      return { disconnected: true as const };
    }
    if (provider === "kiro") {
      const session = kiroSessions.get(target);
      if (session) {
        kiroSessions.delete(target);
        session.pendingApprovals.clear();
        closeKiroAcpTerminals(session);
        await session.connection.close();
      }
      return { disconnected: true as const };
    }
    const session = sessions.get(target);
    if (session) {
      sessions.delete(target);
      session.unsubscribe();
      await session.api.close();
    }
    return { disconnected: true as const };
  },
  answerApproval: async ({ target, requestId, decision, provider }) => {
    if (provider === "opencode") throw new Error("OpenCode approval responses are managed by the OpenCode server.");
    if (provider === "kiro") {
      const session = requireKiroSession(target);
      const approvalKey = String(requestId);
      const approval = session.pendingApprovals.get(approvalKey);
      if (!approval) throw new Error("Kiro permission request is no longer active");
      session.pendingApprovals.delete(approvalKey);
      if (decision === "decline") {
        session.connection.respond(requestId, { outcome: "cancelled" });
        return { answered: true as const };
      }
      const selected = approval.options.find((option) => option.kind === (decision === "acceptForSession" ? "allow_always" : "allow_once")) ??
        approval.options.find((option) => typeof option.optionId === "string" && /allow|accept/i.test(`${option.kind ?? ""} ${option.name ?? ""}`));
      if (!selected || typeof selected.optionId !== "string") throw new Error("Kiro did not offer an approval option for this action");
      session.connection.respond(requestId, { outcome: "selected", optionId: selected.optionId });
      return { answered: true as const };
    }
    const session = sessions.get(target);
    if (!session) throw new Error("Codex connection is no longer active");
    session.api.respondToRequest(requestId, { decision });
    return { answered: true as const };
  }
};

const daemonRequestHandlers: Record<SharedDaemonApiMethod, DaemonRequestHandler> = {
  listProviders: async () => ({ providers: ASSISTANT_PROVIDERS }),
  terminalStart: async ({ target, cwd, sessionId, cols, rows }) => {
    await startTerminal(target, cwd, sessionId, cols, rows);
    return { sessionId, started: true as const };
  },
  terminalInput: async ({ target, sessionId, data }) => {
    const terminal = requireTerminal(target, sessionId);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      throw new Error("Invalid terminal input encoding");
    }
    if (terminal.pty) terminal.pty.write(Buffer.from(data, "base64").toString("utf8"));
    else terminal.stream?.write(JSON.stringify({ type: "input", data }) + "\n");
    return { written: true as const };
  },
  terminalResize: async ({ target, sessionId, cols, rows }) => {
    const terminal = requireTerminal(target, sessionId);
    const width = clampTerminalDimension(cols, 120);
    const height = clampTerminalDimension(rows, 32);
    if (terminal.pty) terminal.pty.resize(width, height);
    else terminal.stream?.write(JSON.stringify({ type: "resize", cols: width, rows: height }) + "\n");
    return { resized: true as const };
  },
  terminalStop: async ({ target, sessionId }) => {
    stopTerminal(target, sessionId);
    return { stopped: true as const };
  },
  listWorkspaceFiles: async ({ target, cwd, path }) => {
    const relay = parseHiveRelayTarget(target);
    const result = target === LOCAL_CODEX_TARGET
      ? await listLocalWorkspaceFiles(cwd, path)
      : relay
        ? await requestRelayWorkspaceFile(relay, "list", cwd, path)
        : await requestSshWorkspaceFile(target, cwd, "list", path);
    if (!("items" in result)) throw new Error("Remote workspace returned an invalid directory listing");
    return result;
  },
  readWorkspaceFile: async ({ target, cwd, path }) => {
    const relay = parseHiveRelayTarget(target);
    const result = target === LOCAL_CODEX_TARGET
      ? await readLocalWorkspaceFile(cwd, path)
      : relay
        ? await requestRelayWorkspaceFile(relay, "read", cwd, path)
        : await requestSshWorkspaceFile(target, cwd, "read", path);
    if (!("content" in result)) throw new Error("Remote workspace returned an invalid file preview");
    return result;
  }
};


async function startTerminal(target: string, cwd: string, sessionId: string, cols: number, rows: number): Promise<void> {
  if (!cwd.trim() || !isAbsolutePath(cwd)) throw new Error("Select an absolute workspace path before opening the terminal");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) throw new Error("Invalid terminal session ID");
  if (terminals.has(sessionId)) throw new Error("This terminal session is already open");
  const terminal: TerminalSession = { target, sessionId, abort: new AbortController(), stopped: false, receiveBuffer: Buffer.alloc(0) };
  terminals.set(sessionId, terminal);
  const width = clampTerminalDimension(cols, 120);
  const height = clampTerminalDimension(rows, 32);
  try {
    if (target === LOCAL_CODEX_TARGET) {
      const shell = process.platform === "win32" ? (process.env.COMSPEC || "cmd.exe") : (process.env.SHELL || "/bin/bash");
      const args = process.platform === "win32" ? [] : ["-l"];
      const ptySession = spawnPty(shell, args, {
        name: "xterm-256color",
        cols: width,
        rows: height,
        cwd,
        env: process.env as Record<string, string>,
      });
      terminal.pty = ptySession;
      ptySession.onData((data) => sendTerminalEvent(terminal, "terminal/data", { data: Buffer.from(data, "utf8").toString("base64") }));
      ptySession.onExit(({ exitCode, signal }) => sendTerminalEvent(terminal, "terminal/exit", { exitCode, signal: signal ?? null }));
      return;
    }

    const relay = parseHiveRelayTarget(target);
    if (relay) {
      const socket = await connectHiveRelay(relay, "client", terminal.abort.signal, "terminal");
      if (terminal.stopped) { socket.destroy(); throw new Error("Terminal opening was cancelled"); }
      const stream = await secureRelayStream(socket, relay, "client", "terminal");
      if (terminal.stopped) { stream.destroy(); throw new Error("Terminal opening was cancelled"); }
      terminal.stream = stream;
      stream.on("data", (chunk: Buffer) => receiveTerminalData(terminal, chunk));
      stream.once("error", (error) => sendTerminalEvent(terminal, "terminal/error", { message: error.message }));
      stream.once("close", () => {
        if (!terminal.stopped) sendTerminalEvent(terminal, "terminal/exit", { exitCode: null, signal: null });
      });
      stream.write(JSON.stringify({ type: "start", cwd, cols: width, rows: height }) + "\n");
      return;
    }

    assertSshTarget(target);
    const ptySession = spawnPty("ssh", ["-tt", "-o", "ServerAliveInterval=30", target, remoteTerminalCommand(cwd)], {
      name: "xterm-256color",
      cols: width,
      rows: height,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
    terminal.pty = ptySession;
    ptySession.onData((data) => sendTerminalEvent(terminal, "terminal/data", { data: Buffer.from(data, "utf8").toString("base64") }));
    ptySession.onExit(({ exitCode, signal }) => sendTerminalEvent(terminal, "terminal/exit", { exitCode, signal: signal ?? null }));
  } catch (error) {
    stopTerminal(target, sessionId);
    throw error;
  }
}

function receiveTerminalData(terminal: TerminalSession, chunk: Buffer): void {
  terminal.receiveBuffer = Buffer.concat([terminal.receiveBuffer, chunk]);
  if (terminal.receiveBuffer.length > 1024 * 1024 && terminal.receiveBuffer.indexOf(0x0a) < 0) {
    sendTerminalEvent(terminal, "terminal/error", { message: "Terminal relay message exceeded the size limit" });
    terminal.stream?.destroy();
    return;
  }
  while (true) {
    const newline = terminal.receiveBuffer.indexOf(0x0a);
    if (newline < 0) return;
    const line = terminal.receiveBuffer.subarray(0, newline);
    terminal.receiveBuffer = terminal.receiveBuffer.subarray(newline + 1);
    try {
      const message = asObject(JSON.parse(line.toString("utf8")) as unknown);
      if (!message) throw new Error("Invalid relay message");
      if (message.type === "data" && typeof message.data === "string") {
        sendTerminalEvent(terminal, "terminal/data", { data: message.data });
      } else if (message.type === "ready") {
        sendTerminalEvent(terminal, "terminal/ready", { cwd: message.cwd ?? "" });
      } else if (message.type === "error" && typeof message.message === "string") {
        sendTerminalEvent(terminal, "terminal/error", { message: message.message });
      } else if (message.type === "exit") {
        sendTerminalEvent(terminal, "terminal/exit", { exitCode: message.exitCode ?? null, signal: message.signal ?? null });
      }
    } catch (error) {
      sendTerminalEvent(terminal, "terminal/error", { message: errorMessage(error) });
    }
  }
}

function sendTerminalEvent(terminal: TerminalSession, method: string, params: Record<string, unknown>): void {
  if (terminal.stopped) return;
  publishBridgeEvent({ target: terminal.target, threadId: terminal.sessionId, method, params });
}

function publishBridgeEvent(event: BridgeEvent): void {
  for (const listener of daemonEventListeners) listener(event);
}

function publishOpenCodeBridgeEvent(event: OpenCodeBridgeEvent): void {
  publishBridgeEvent({ ...event, provider: "opencode" });
}

function publishKiroBridgeEvent(target: string, threadId: string, method: string, params: unknown, requestId?: number | string): void {
  publishBridgeEvent({ target, threadId, method, params, provider: "kiro", ...(requestId !== undefined ? { requestId } : {}) });
}

function subscribeKiroSession(session: KiroRemoteSession, target: string, threadId: string): void {
  session.updateUnsubscribers.get(threadId)?.();
  const unsubscribe = session.connection.onSessionUpdate(threadId, ({ update }) => {
    const transcript = session.transcriptsByThread.get(threadId);
    if (transcript) collectKiroTranscript(transcript, update);
    publishKiroSessionUpdate(session, target, threadId, update);
  });
  session.updateUnsubscribers.set(threadId, unsubscribe);
}

function publishKiroSessionUpdate(session: KiroRemoteSession, target: string, threadId: string, update: JsonObject): void {
  const kind = kiroUpdateKind(update);
  const turnId = firstString(update.turnId, update.turn_id, session.activeTurnIds.get(threadId)) ?? "turn";
  if (kind === "agent_message_chunk") {
    const text = kiroContentText(update.content ?? update.text);
    if (!text) return;
    const itemId = firstString(update.messageId, update.itemId, update.id) ?? "kiro-agent-message";
    publishKiroBridgeEvent(target, threadId, "item/agentMessage/delta", { threadId, turnId, itemId, delta: text });
    return;
  }
  if (kind === "tool_call") {
    const id = firstString(update.toolCallId, update.id) ?? `kiro-tool-${Date.now()}`;
    const title = firstString(update.title, update.name) ?? "Kiro tool";
    publishKiroBridgeEvent(target, threadId, "item/started", {
      threadId,
      turnId,
      item: { id, type: "commandExecution", command: title, status: "inProgress" },
    });
    return;
  }
  if (kind === "tool_call_update") {
    const id = firstString(update.toolCallId, update.id) ?? `kiro-tool-${Date.now()}`;
    const title = firstString(update.title, update.name) ?? "Kiro tool";
    const status = firstString(update.status) ?? "completed";
    const output = kiroContentText(update.rawOutput ?? update.content ?? update.output);
    publishKiroBridgeEvent(target, threadId, "item/completed", {
      threadId,
      turnId,
      item: { id, type: "commandExecution", command: title, status, aggregatedOutput: output },
    });
    return;
  }
  if (kind === "session_info_update") {
    const title = firstString(update.title, update.sessionName);
    if (title) publishKiroBridgeEvent(target, threadId, "thread/name/updated", { threadId, name: title });
  }
}

function collectKiroTranscript(entries: TranscriptEntry[], update: JsonObject): void {
  const kind = kiroUpdateKind(update);
  const explicitTurnId = firstString(update.turnId, update.turn_id);
  const lastUser = [...entries].reverse().find((entry) => entry.role === "user");
  const lastAssistant = [...entries].reverse().find((entry) => entry.role === "assistant");
  if (explicitTurnId && lastUser) lastUser.turnId = explicitTurnId;
  const isUserChunk = kind === "user_message_chunk";
  const userCount = entries.filter((entry) => entry.role === "user").length;
  const turnId = explicitTurnId ?? (isUserChunk
    ? (entries.at(-1)?.role === "user" ? lastUser?.turnId : undefined)
    : lastUser?.turnId ?? lastAssistant?.turnId) ?? `kiro-turn-${userCount}`;
  if (kind === "user_message_chunk" || kind === "agent_message_chunk") {
    const role = kind === "user_message_chunk" ? "user" : "assistant";
    const text = kiroContentText(update.content ?? update.text);
    if (!text) return;
    if (role === "user") {
      for (const entry of [...entries].reverse()) {
        if (entry.role === "assistant" && entry.responseCompleted === false) {
          entry.responseCompleted = true;
          entry.status = "completed";
        }
      }
    }
    if (role === "user" && lastUser && (lastUser.text === text || lastUser.text.startsWith(text))) return;
    const providerMessageId = firstString(update.messageId, update.itemId, update.id);
    const previous = [...entries].reverse().find((entry) => entry.role === role && entry.turnId === turnId &&
      (!providerMessageId || !entry.providerMessageId || entry.providerMessageId === providerMessageId));
    if (previous) previous.text += text;
    else entries.push({
      id: `kiro-${role}-${turnId}-${entries.length}`,
      role,
      text,
      turnId,
      ...(role === "assistant" ? { providerMessageId: providerMessageId ?? `kiro-message-${entries.length}`, responseCompleted: false, status: "inProgress" } : {}),
    });
    return;
  }
  if (kind === "turn_end" || kind === "turn_complete" || kind === "turn_completed") {
    for (const entry of [...entries].reverse()) {
      if (entry.role === "assistant" && (entry.turnId === turnId || !explicitTurnId && entry.responseCompleted === false)) {
        entry.responseCompleted = true;
        entry.status = "completed";
        break;
      }
    }
    return;
  }
  if (kind !== "tool_call" && kind !== "tool_call_update") return;
  const id = firstString(update.toolCallId, update.id) ?? `kiro-tool-${entries.length}`;
  const title = firstString(update.title, update.name) ?? "Kiro tool";
  const status = firstString(update.status) ?? (kind === "tool_call" ? "inProgress" : "completed");
  const output = kiroContentText(update.rawOutput ?? update.content ?? update.output);
  const entry: TranscriptEntry = {
    id,
    role: "tool",
    text: status,
    toolType: "commandExecution",
    command: title,
    output,
    status,
  };
  const previousIndex = entries.findIndex((candidate) => candidate.id === id);
  if (previousIndex >= 0) entries[previousIndex] = entry;
  else entries.push(entry);
}

function kiroUpdateKind(update: JsonObject): string {
  const value = firstString(update.sessionUpdate, update.type, update.kind) ?? "";
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[ -]/g, "_").toLowerCase();
}

function kiroContentText(value: unknown): string {
  if (typeof value === "string") return value;
  const content = asObject(value);
  if (content) return firstString(content.text, content.outputText, content.inputText) ?? "";
  return contentText(value);
}

function validateKiroPromptImages(value: unknown): KiroPromptImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Kiro image attachments must be a list");
  if (value.length > 4) throw new Error("Kiro accepts up to four images per message");
  let totalBytes = 0;
  return value.map((item, index) => {
    const image = asObject(item);
    const name = firstString(image?.name);
    const mimeType = firstString(image?.mimeType)?.toLowerCase();
    const data = typeof image?.data === "string" ? image.data : "";
    if (!image || !name || name.length > 200) throw new Error(`Kiro image ${index + 1} has an invalid filename`);
    if (!mimeType || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType)) {
      throw new Error(`Kiro image ${name} must be PNG, JPEG, GIF, or WebP`);
    }
    if (!data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error(`Kiro image ${name} has invalid base64 data`);
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    const sizeBytes = Math.floor(data.length * 3 / 4) - padding;
    if (sizeBytes <= 0 || sizeBytes > 4 * 1024 * 1024) throw new Error(`Kiro image ${name} must be 4 MB or smaller`);
    totalBytes += sizeBytes;
    if (totalBytes > 8 * 1024 * 1024) throw new Error("Kiro image attachments cannot exceed 8 MB in total");
    return { name, mimeType, data };
  });
}

async function handleKiroServerRequest(session: KiroRemoteSession, target: string, request: KiroServerRequest): Promise<void> {
  try {
    if (/permission/i.test(request.method)) {
      const threadId = firstString(request.params.sessionId);
      if (!threadId) {
        session.connection.respond(request.id, { outcome: "cancelled" });
        return;
      }
      const options = (Array.isArray(request.params.options) ? request.params.options : []).map(asObject).filter((option): option is JsonObject => Boolean(option));
      session.pendingApprovals.set(String(request.id), { threadId, options });
      publishKiroBridgeEvent(target, threadId, request.method, request.params, request.id);
      return;
    }

    if (request.method === "fs/read_text_file" || request.method === "fs/write_text_file" || request.method.startsWith("terminal/")) {
      const threadId = firstString(request.params.sessionId);
      if (!threadId || !session.openedThreadIds.has(threadId)) throw new Error("Kiro ACP request refers to a session that is not open in Hive");
      const cwd = session.cwdByThread.get(threadId);
      if (!cwd) throw new Error("Kiro workspace path is unavailable for this session");
      if (request.method === "fs/read_text_file") {
        const filePath = firstString(request.params.path);
        if (!filePath) throw new Error("Kiro ACP file read requires an absolute path");
        const result = target === LOCAL_CODEX_TARGET
          ? await readLocalWorkspaceFile(cwd, kiroWorkspaceRelativePath(cwd, filePath))
          : await requestSshWorkspaceFile(target, cwd, "read", kiroWorkspaceRelativePath(cwd, filePath));
        const line = request.params.line;
        const limit = request.params.limit;
        if (line !== undefined && (!Number.isInteger(line) || (line as number) < 1)) throw new Error("Kiro ACP file read line must be a positive integer");
        if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 0)) throw new Error("Kiro ACP file read limit must be a non-negative integer");
        if (!("content" in result) || typeof result.content !== "string") throw new Error("Kiro ACP file read returned invalid content");
        const startLine = line === undefined ? 1 : line as number;
        const content = line === undefined && limit === undefined
          ? result.content
          : result.content.split("\n").slice(startLine - 1, limit === undefined ? undefined : (startLine - 1) + (limit as number)).join("\n");
        session.connection.respond(request.id, { content });
        return;
      }
      if (request.method === "fs/write_text_file") {
        const filePath = firstString(request.params.path);
        const content = typeof request.params.content === "string" ? request.params.content : undefined;
        if (!filePath || content === undefined) throw new Error("Kiro ACP file write requires an absolute path and text content");
        const relativePath = kiroWorkspaceRelativePath(cwd, filePath);
        if (target === LOCAL_CODEX_TARGET) await writeLocalWorkspaceFile(cwd, relativePath, content);
        else await requestSshWorkspaceWrite(target, cwd, relativePath, content);
        session.connection.respond(request.id, {});
        return;
      }
      const terminalId = firstString(request.params.terminalId);
      if (request.method === "terminal/create") {
        const terminal = await createKiroAcpTerminal(session, target, threadId, cwd, request.params);
        session.connection.respond(request.id, { terminalId: terminal.id });
        return;
      }
      if (!terminalId) throw new Error(`${request.method} requires a terminal ID`);
      const terminal = session.terminalsById.get(terminalId);
      if (!terminal || terminal.threadId !== threadId) throw new Error("Kiro ACP terminal is no longer active");
      if (request.method === "terminal/output") {
        session.connection.respond(request.id, {
          output: terminal.output.toString("utf8"),
          truncated: terminal.truncated,
          ...(terminal.exited ? { exitStatus: { exitCode: terminal.exitCode, signal: terminal.signal } } : {}),
        });
      } else if (request.method === "terminal/wait_for_exit") {
        await terminal.exitPromise;
        session.connection.respond(request.id, { exitCode: terminal.exitCode, signal: terminal.signal });
      } else if (request.method === "terminal/kill") {
        if (!terminal.exited) terminal.pty.kill();
        session.connection.respond(request.id, {});
      } else if (request.method === "terminal/release") {
        if (!terminal.exited) terminal.pty.kill();
        session.terminalsById.delete(terminal.id);
        session.connection.respond(request.id, {});
      } else {
        session.connection.respondError(request.id, -32601, `Unsupported Kiro ACP request: ${request.method}`);
      }
      return;
    }

    session.connection.respondError(request.id, -32601, `Unsupported Kiro ACP request: ${request.method}`);
  } catch (error) {
    session.connection.respondError(request.id, -32000, errorMessage(error));
  }
}

async function createKiroAcpTerminal(session: KiroRemoteSession, target: string, threadId: string, workspace: string, params: JsonObject): Promise<KiroAcpTerminal> {
  if (session.terminalsById.size >= 8) throw new Error("Kiro ACP supports up to eight active terminals per connection");
  const command = firstString(params.command);
  if (!command || command.length > 4_096 || command.includes("\0")) throw new Error("Kiro ACP terminal command is invalid");
  const argsValue = params.args;
  if (argsValue !== undefined && (!Array.isArray(argsValue) || argsValue.length > 256 || argsValue.some((arg) => typeof arg !== "string" || arg.length > 16_384 || arg.includes("\0")))) {
    throw new Error("Kiro ACP terminal arguments are invalid");
  }
  const args = (Array.isArray(argsValue) ? argsValue : []) as string[];
  const envValue = params.env;
  if (envValue !== undefined && (!Array.isArray(envValue) || envValue.length > 128)) throw new Error("Kiro ACP terminal environment is invalid");
  const env: Record<string, string> = {};
  for (const itemValue of Array.isArray(envValue) ? envValue : []) {
    const item = asObject(itemValue);
    const name = firstString(item?.name);
    const value = typeof item?.value === "string" ? item.value : undefined;
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value === undefined || value.includes("\0")) throw new Error("Kiro ACP terminal environment contains an invalid variable");
    env[name] = value;
  }
  const requestedCwd = firstString(params.cwd) ?? workspace;
  const terminalCwd = await resolveKiroTerminalCwd(target, workspace, requestedCwd);
  const requestedLimit = params.outputByteLimit;
  if (requestedLimit !== undefined && (!Number.isSafeInteger(requestedLimit) || (requestedLimit as number) < 0)) throw new Error("Kiro ACP terminal output limit is invalid");
  const outputByteLimit = Math.min(4 * 1024 * 1024, requestedLimit === undefined ? 1024 * 1024 : requestedLimit as number);
  if (Buffer.byteLength(JSON.stringify({ root: workspace, cwd: terminalCwd, command, args, env }), "utf8") > 64 * 1024) {
    throw new Error("Kiro ACP terminal command metadata exceeds 64 KiB");
  }
  const id = randomUUID();
  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolvePromise) => { resolveExit = resolvePromise; });
  let pty: IPty;
  if (target === LOCAL_CODEX_TARGET) {
    pty = spawnPty(command, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd: terminalCwd,
      env: { ...process.env, ...env },
    });
  } else {
    const payload = Buffer.from(JSON.stringify({ root: workspace, cwd: terminalCwd, command, args, env }), "utf8").toString("base64");
    const remoteCommand = `python3 -c ${shellQuote(KIRO_REMOTE_TERMINAL_SCRIPT)} ${shellQuote(payload)}`;
    pty = spawnPty("ssh", ["-tt", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "--", target, remoteCommand], {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
  }
  const terminal: KiroAcpTerminal = {
    id,
    threadId,
    pty,
    output: Buffer.alloc(0),
    outputByteLimit,
    truncated: false,
    exited: false,
    exitCode: null,
    signal: null,
    exitPromise,
    resolveExit,
  };
  pty.onData((data) => appendKiroTerminalOutput(terminal, data));
  pty.onExit(({ exitCode, signal }) => {
    terminal.exited = true;
    terminal.exitCode = Number.isInteger(exitCode) ? exitCode : null;
    terminal.signal = signal === undefined || signal === null ? null : String(signal);
    terminal.resolveExit();
  });
  session.terminalsById.set(id, terminal);
  return terminal;
}

async function resolveKiroTerminalCwd(target: string, workspace: string, requestedCwd: string): Promise<string> {
  if (!isAbsolute(requestedCwd)) throw new Error("Kiro ACP terminal working directory must be absolute");
  if (target === LOCAL_CODEX_TARGET) {
    const root = await realpath(workspace);
    const cwd = await realpath(requestedCwd);
    if (!isWithinFilesystemPath(root, cwd)) throw new Error("Kiro ACP terminal working directory must stay inside the selected workspace");
    if (!(await stat(cwd)).isDirectory()) throw new Error("Kiro ACP terminal working directory must be a directory");
    return cwd;
  }
  const root = resolve(workspace);
  const cwd = resolve(requestedCwd);
  if (!isWithinFilesystemPath(root, cwd)) throw new Error("Kiro ACP terminal working directory must stay inside the selected workspace");
  return cwd;
}

function kiroWorkspaceRelativePath(workspace: string, absolutePath: string): string {
  if (!isAbsolute(absolutePath)) throw new Error("Kiro ACP file paths must be absolute");
  const root = resolve(workspace);
  const requested = resolve(absolutePath);
  const relativePath = relative(root, requested);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error("Kiro ACP file paths must stay inside the selected workspace");
  }
  return relativePath;
}

function isWithinFilesystemPath(root: string, target: string): boolean {
  const remainder = relative(root, target);
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

function appendKiroTerminalOutput(terminal: KiroAcpTerminal, text: string): void {
  if (terminal.outputByteLimit === 0) {
    terminal.truncated ||= text.length > 0;
    return;
  }
  const combined = Buffer.concat([terminal.output, Buffer.from(text, "utf8")]);
  if (combined.length <= terminal.outputByteLimit) {
    terminal.output = combined;
    return;
  }
  terminal.truncated = true;
  let start = combined.length - terminal.outputByteLimit;
  while (start < combined.length && (combined[start]! & 0xc0) === 0x80) start++;
  terminal.output = combined.subarray(start);
}

function closeKiroAcpTerminals(session: KiroRemoteSession): void {
  for (const terminal of session.terminalsById.values()) {
    if (!terminal.exited) terminal.pty.kill();
  }
  session.terminalsById.clear();
}

function requireTerminal(target: string, sessionId: string): TerminalSession {
  const terminal = terminals.get(sessionId);
  if (!terminal || terminal.target !== target || terminal.stopped) throw new Error("Terminal session is no longer active");
  return terminal;
}

function stopTerminal(target: string, sessionId: string): void {
  const terminal = terminals.get(sessionId);
  if (!terminal || terminal.target !== target) return;
  terminals.delete(sessionId);
  terminal.stopped = true;
  terminal.abort.abort();
  if (terminal.pty) terminal.pty.kill();
  if (terminal.stream && !terminal.stream.destroyed) {
    terminal.stream.end(JSON.stringify({ type: "close" }) + "\n");
    setTimeout(() => terminal.stream?.destroy(), 200).unref();
  }
}

function clampTerminalDimension(value: number, fallback: number): number {
  return Number.isInteger(value) ? Math.max(2, Math.min(500, value)) : fallback;
}

function remoteTerminalCommand(cwd: string): string {
  const loginShell = `cd -- ${shellQuote(cwd)} && exec "\${SHELL:-/bin/bash}" -l`;
  return `bash -lc ${shellQuote(loginShell)}`;
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

const KIRO_REMOTE_TERMINAL_SCRIPT = [
  "import os,sys,json,base64",
  "try:",
  " p=json.loads(base64.b64decode(sys.argv[1])); root=os.path.realpath(p['root']); cwd=os.path.realpath(p['cwd'])",
  " if os.path.commonpath([root,cwd]) != root: raise ValueError('Terminal working directory must stay inside the selected workspace')",
  " if not os.path.isdir(cwd): raise ValueError('Terminal working directory must be a directory')",
  " os.chdir(cwd); env=os.environ.copy(); env.update(p.get('env',{})); command=p['command']; os.execvpe(command,[command]+p.get('args',[]),env)",
  "except Exception as e:",
  " print(str(e),file=sys.stderr); sys.exit(127)",
].join("\n");

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

async function getOrConnect(target: string): Promise<RemoteSession> {
  const existing = sessions.get(target);
  if (existing) return existing;
  const pending = connecting.get(target);
  if (pending) return pending;

  const task = (async () => {
    const api = await CodexAppServerApi.connect(target);
    const session: RemoteSession = {
      api,
      openedThreadIds: new Set(),
      unsubscribe: () => {},
      skillsByThread: new Map(),
      models: [],
      settingsByThread: new Map(),
    };
    session.unsubscribe = api.onNotification((method, params, requestId) => {
      if (requestId !== undefined) {
        handleServerRequest(session, target, method, params, requestId);
        return;
      }
      const threadId = eventThreadId(params) ?? session.activeThreadId;
      if (!threadId) return;
      if (method === "thread/settings/updated") {
        const settings = asObject(asObject(params)?.threadSettings);
        const permissionProfile = firstString(asObject(settings?.activePermissionProfile)?.id);
        const collaborationMode = firstString(asObject(settings?.collaborationMode)?.mode);
        const current = session.settingsByThread.get(threadId);
        if (current && (permissionProfile || collaborationMode === "default" || collaborationMode === "plan")) {
          session.settingsByThread.set(threadId, {
            ...current,
            ...(permissionProfile ? { permissionProfile } : {}),
            ...(collaborationMode === "default" || collaborationMode === "plan" ? { collaborationMode } : {}),
          });
        }
      }
      publishBridgeEvent({ target, threadId, method, params, provider: "codex" });
    });
    sessions.set(target, session);
    return session;
  })();
  connecting.set(target, task);
  try {
    return await task;
  } catch (error) {
    throw new Error(connectionFriendlyError(target, error));
  } finally {
    connecting.delete(target);
  }
}

async function getOrConnectOpenCode(
  target: string,
): Promise<OpenCodeRemoteSession> {
  const existing = openCodeSessions.get(target);
  if (existing) return existing;
  const pending = openCodeConnecting.get(target);
  if (pending) return pending;
  const task = (async () => {
    let connection: OpenCodeProviderConnection;
    try {
      const server = await ensureOpenCodeServer();
      connection = await OpenCodeProviderConnection.connect(server.endpoint, server.username, server.password ?? "");
    } catch (error) {
      const endpoint = process.env.HIVE_OPENCODE_URL?.trim() || "http://127.0.0.1:4096";
      throw new Error(`Hive 실행 host에서 OpenCode 서버 ${endpoint}에 연결하지 못했습니다: ${errorMessage(error)}`);
    }
    const session: OpenCodeRemoteSession = {
      connection,
      openedThreadIds: new Set(),
      settingsByThread: new Map(),
      modelsByThread: new Map(),
      cwdByThread: new Map(),
      skillsByThread: new Map(),
    };
    openCodeSessions.set(target, session);
    return session;
  })();
  openCodeConnecting.set(target, task);
  try { return await task; }
  finally { openCodeConnecting.delete(target); }
}

async function getOrConnectKiro(target: string): Promise<KiroRemoteSession> {
  const existing = kiroSessions.get(target);
  if (existing) return existing;
  const pending = kiroConnecting.get(target);
  if (pending) return pending;
  const task = (async () => {
    let connection: KiroAcpConnection;
    try {
      connection = await KiroAcpConnection.connect(target);
    } catch (error) {
      throw new Error(`Kiro CLI에 연결하지 못했습니다: ${errorMessage(error)}\n확인: 대상 host에 Kiro CLI가 설치되어 있고 Kiro에 로그인되어 있어야 합니다.`);
    }
    const session: KiroRemoteSession = {
      connection,
      openedThreadIds: new Set(),
      settingsByThread: new Map(),
      cwdByThread: new Map(),
      models: [],
      commandsByThread: new Map(),
      skillsByThread: new Map(),
      modesByThread: new Map(),
      currentModeByThread: new Map(),
      policyPresetsByThread: new Map(),
      transcriptsByThread: new Map(),
      activeTurnIds: new Map(),
      pendingApprovals: new Map(),
      terminalsById: new Map(),
      updateUnsubscribers: new Map(),
    };
    connection.onServerRequest((request) => { void handleKiroServerRequest(session, target, request); });
    connection.onNotification((notification) => handleKiroNotification(session, target, notification));
    kiroSessions.set(target, session);
    return session;
  })();
  kiroConnecting.set(target, task);
  try { return await task; }
  finally { kiroConnecting.delete(target); }
}

function requireKiroSession(target: string): KiroRemoteSession {
  const session = kiroSessions.get(target);
  if (!session) throw new Error("Kiro 연결이 만료되었습니다. 연결 설정에서 다시 연결하세요.");
  return session;
}

function validateKiroPresets(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((preset) => typeof preset !== "string")) throw new Error("Kiro permission presets must be a list of preset names");
  const allowed = new Set(["allow-all", "edit-workspace", "read-workspace", "read-all", "read-only-shell", "dev-shell"]);
  const invalid = value.find((preset) => !allowed.has(preset));
  if (invalid) throw new Error(`Unknown Kiro permission preset: ${invalid}`);
  return [...new Set(value as string[])];
}

function kiroModes(result: JsonObject): RemoteMode[] {
  const state = asObject(result.modes);
  const available = Array.isArray(state?.availableModes) ? state.availableModes : Array.isArray(state?.modes) ? state.modes : [];
  return available.flatMap((value): RemoteMode[] => {
    const mode = asObject(value);
    const id = firstString(mode?.id, mode?.modeId);
    if (!mode || !id) return [];
    return [{ id, name: firstString(mode.name, mode.title) ?? id, description: firstString(mode.description) ?? "" }];
  });
}

async function kiroEffortOptions(session: KiroRemoteSession, threadId: string): Promise<{ options: RemoteReasoningEffort[]; current?: string }> {
  try {
    const raw = await session.connection.commandOptions(threadId, "effort", "");
    const options = raw.flatMap((option): RemoteReasoningEffort[] => {
      const value = firstString(option.value, option.id, option.name);
      if (!value) return [];
      return [{ reasoningEffort: value, description: firstString(option.description, option.label) ?? value }];
    });
    const current = raw.find((option) => option.current === true);
    const currentValue = current ? firstString(current.value, current.id, current.name) : undefined;
    return { options, ...(currentValue ? { current: currentValue } : {}) };
  } catch {
    return { options: [] };
  }
}

function withKiroEffortOptions(models: RemoteModel[], modelId: string, options: RemoteReasoningEffort[]): RemoteModel[] {
  if (models.some((model) => model.model === modelId)) {
    return models.map((model) => model.model === modelId ? { ...model, supportedReasoningEfforts: options } : model);
  }
  return [...models, {
    model: modelId,
    displayName: modelId === "auto" ? "Auto" : modelId,
    description: modelId === "auto" ? "Kiro가 요청에 맞는 모델을 선택합니다." : "현재 세션에서 사용 중인 Kiro 모델입니다.",
    defaultReasoningEffort: "",
    supportedReasoningEfforts: options,
    isDefault: modelId === "auto",
    hidden: false,
  }];
}

async function loadKiroSkills(session: KiroRemoteSession, target: string, threadId: string, cwd: string): Promise<RemoteSkill[]> {
  try {
    const skills = await listKiroSkills(target, cwd);
    const remote = skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      provider: "Kiro",
      scope: skill.scope,
      enabled: skill.enabled,
    }));
    session.skillsByThread.set(threadId, remote);
    return remote;
  } catch {
    session.skillsByThread.set(threadId, []);
    return [];
  }
}

function listKiroCommands(session: KiroRemoteSession, threadId: string): RemoteCommand[] {
  const known = session.commandsByThread.get(threadId) ?? [];
  const commands = new Map<string, RemoteCommand>();
  for (const command of known) commands.set(command.name, command);
  const documented: RemoteCommand[] = [
    { name: "agent", description: "Kiro 에이전트를 바꿉니다.", provider: "Kiro", takesArguments: true },
    { name: "chat", description: "Kiro 채팅 세션을 관리합니다.", provider: "Kiro", takesArguments: true },
    { name: "clear", description: "대화 표시를 지웁니다.", provider: "Kiro", takesArguments: false },
    { name: "compact", description: "대화 맥락을 압축합니다.", provider: "Kiro", takesArguments: false },
    { name: "context", description: "프로젝트 맥락 파일을 관리합니다.", provider: "Kiro", takesArguments: true },
    { name: "effort", description: "모델의 Thinking 수준을 바꿉니다.", provider: "Kiro", takesArguments: true },
    { name: "help", description: "Kiro CLI 도움말을 엽니다.", provider: "Kiro", takesArguments: false },
    { name: "mcp", description: "MCP 서버 상태를 확인합니다.", provider: "Kiro", takesArguments: true },
    { name: "model", description: "현재 세션의 모델을 바꿉니다.", provider: "Kiro", takesArguments: true },
    { name: "rewind", description: "이전 대화 시점에서 새 세션을 만듭니다.", provider: "Kiro", takesArguments: true },
    { name: "tools", description: "도구 권한을 확인하고 관리합니다.", provider: "Kiro", takesArguments: true },
    { name: "plan", description: "Kiro Plan 에이전트로 전환합니다.", provider: "Kiro", takesArguments: true },
  ];
  for (const command of documented) if (!commands.has(command.name)) commands.set(command.name, command);
  for (const skill of session.skillsByThread.get(threadId) ?? []) {
    if (!commands.has(skill.name)) commands.set(skill.name, { name: skill.name, description: skill.description, provider: "Kiro skill", takesArguments: true });
  }
  return [...commands.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function handleKiroNotification(session: KiroRemoteSession, target: string, notification: KiroNotification): void {
  const threadId = firstString(notification.params.sessionId, notification.params.threadId) ?? [...session.openedThreadIds].at(-1);
  if (notification.method === "_kiro.dev/mcp/oauth_request" && threadId) {
    const server = firstString(notification.params.serverName, notification.params.name, asObject(notification.params.server)?.name) ?? "MCP";
    const authorizationUrl = firstString(notification.params.authorizationUrl, notification.params.authUrl, notification.params.oauthUrl, notification.params.url);
    publishKiroBridgeEvent(target, threadId, "warning", {
      threadId,
      message: `${server} MCP 서버에 OAuth 인증이 필요합니다${authorizationUrl ? `: ${authorizationUrl}` : ". Kiro CLI에서 인증을 완료하세요."}`,
    });
    return;
  }
  if (notification.method === "_kiro.dev/mcp/server_initialized" && threadId) {
    const server = firstString(notification.params.serverName, notification.params.name, asObject(notification.params.server)?.name) ?? "MCP";
    publishKiroBridgeEvent(target, threadId, "warning", { threadId, message: `${server} MCP 서버가 준비되었습니다.` });
    return;
  }
  if ((notification.method === "_kiro.dev/compaction/status" || notification.method === "_kiro.dev/clear/status") && threadId) {
    const status = firstString(notification.params.message, notification.params.status, notification.params.state, notification.params.phase);
    if (status) {
      const operation = notification.method === "_kiro.dev/compaction/status" ? "맥락 압축" : "대화 지우기";
      publishKiroBridgeEvent(target, threadId, "warning", { threadId, message: `Kiro ${operation}: ${status}` });
    }
    return;
  }
  if (notification.method === "_kiro.dev/commands/available" && threadId) {
    const values = Array.isArray(notification.params.commands) ? notification.params.commands :
      Array.isArray(notification.params.availableCommands) ? notification.params.availableCommands : [];
    const commands = values.flatMap((value): RemoteCommand[] => {
      const item = asObject(value);
      const rawName = firstString(item?.name, item?.command);
      if (!item || !rawName) return [];
      const name = rawName.replace(/^\/+/, "");
      if (!/^[A-Za-z0-9._/-]{1,128}$/.test(name)) return [];
      const meta = asObject(item.meta);
      return [{ name, description: firstString(item.description) ?? "", provider: "Kiro", takesArguments: Boolean(meta?.inputType && meta.inputType !== "none") }];
    });
    session.commandsByThread.set(threadId, commands);
    publishBridgeEvent({ target, threadId, provider: "kiro", method: "thread/commands/updated", params: { threadId, commands } });
    return;
  }
  if (notification.method === "session/update" && threadId) {
    const update = asObject(notification.params.update) ?? {};
    const kind = kiroUpdateKind(update);
    if (kind === "current_mode_update") {
      const modeId = firstString(update.currentModeId, update.modeId);
      if (modeId) {
        session.currentModeByThread.set(threadId, modeId);
        publishBridgeEvent({ target, threadId, provider: "kiro", method: "thread/settings/updated", params: { threadId, threadSettings: { currentModeId: modeId } } });
      }
    }
  }
}

function kiroCommandArguments(command: string, rawArguments: string): JsonObject {
  const value = rawArguments.trim();
  if (!value) return {};
  if (command === "rewind") {
    if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error("Kiro /rewind expects a positive turn index.");
    return { index: Number(value) };
  }
  return { value };
}

async function forkKiroConversation(
  session: KiroRemoteSession,
  target: string,
  sourceThreadId: string,
  selectedTurnId: string | undefined,
  title: string,
): Promise<{ threadId: string; title: string; cwd: string; model: string; effort: string | null; permissionProfile: string | null; skills: RemoteSkill[]; modes: RemoteMode[]; currentModeId: string | null }> {
  const transcript = session.transcriptsByThread.get(sourceThreadId) ?? [];
  const userEntries = transcript.filter((entry) => entry.role === "user");
  const selectedUserIndex = selectedTurnId
    ? userEntries.findIndex((entry) => entry.turnId === selectedTurnId)
    : -1;
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
  let loaded: JsonObject;
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
  subscribeKiroSession(session, target, forkedId);
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

function timestampValue(value: string | number | null): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function loadOpenCodeSkills(
  session: OpenCodeRemoteSession,
  threadId: string,
  directory: string | undefined,
): Promise<{ skills: OpenCodeSkill[]; warnings: string[] }> {
  try {
    const skills = await session.connection.listSkills(directory || undefined);
    session.skillsByThread.set(threadId, skills);
    return { skills, warnings: [] };
  } catch (error) {
    session.skillsByThread.set(threadId, []);
    return { skills: [], warnings: [`OpenCode 스킬 목록을 가져오지 못했습니다: ${errorMessage(error)}`] };
  }
}

/** Eagerly start and connect the local OpenCode provider during Hive daemon startup. */
export async function warmOpenCodeProvider(): Promise<void> {
  await getOrConnectOpenCode(LOCAL_PROVIDER_TARGET);
}

/** Close OpenCode sessions and the server process owned by this Hive host. */
export async function stopOpenCodeProvider(): Promise<void> {
  for (const session of openCodeSessions.values()) session.connection.close();
  openCodeSessions.clear();
  await stopManagedOpenCodeServer();
}

function requireOpenCodeSession(target: string): OpenCodeRemoteSession {
  const session = openCodeSessions.get(target);
  if (!session) throw new Error("OpenCode 연결이 만료되었습니다. 연결 설정에서 다시 연결하세요.");
  return session;
}

async function deleteOpenCodeSession(connection: OpenCodeProviderConnection, threadId: string): Promise<void> {
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
        await connection.getSession(threadId, AbortSignal.timeout(5_000));
      } catch (verificationError) {
        if (errorMessage(verificationError).includes("OpenCode 서버 응답 오류 404")) return;
      }
      throw new Error(`OpenCode 세션 삭제를 완료하지 못했습니다: ${errorMessage(error)}`, { cause: error });
    }
  }

  await connection.deleteSession(threadId);
}

async function listThreads(api: CodexAppServerApi): Promise<RemoteThread[]> {
  const threads = await api.listThreads({ limit: 500 });
  return threads.map(toRemoteThread);
}

function toRemoteThread(thread: CodexThread): RemoteThread {
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

function transcriptEntries(thread: JsonObject): TranscriptEntry[] {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const entries: TranscriptEntry[] = [];
  for (const turnValue of turns) {
    const turn = asObject(turnValue);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const itemValue of items) {
      const item = asObject(itemValue);
      if (!item) continue;
      const id = firstString(item.id) ?? `entry-${entries.length}`;
      const type = firstString(item.type) ?? "";
      if (type === "userMessage") {
        const text = contentText(item.content);
        if (text) entries.push({ id, role: "user", text });
      } else if (type === "agentMessage") {
        const text = firstString(item.text) ?? contentText(item.content);
        const sourceMessageId = firstString(item.id);
        const turnId = firstString(turn?.id);
        const turnStatus = firstString(turn?.status) ?? "completed";
        if (text) entries.push({ id, role: "assistant", text, ...(turnId ? { turnId } : {}), ...(sourceMessageId ? { providerMessageId: sourceMessageId } : {}), responseCompleted: !["inProgress", "in_progress", "running", "started"].includes(turnStatus) });
      } else if (type === "commandExecution") {
        entries.push({
          id,
          role: "tool",
          text: firstString(item.status) ?? "command",
          toolType: "commandExecution",
          command: firstString(item.command) ?? "",
          output: firstString(item.aggregatedOutput, item.output) ?? "",
          status: firstString(item.status) ?? "completed",
        });
      } else if (type === "fileChange") {
        entries.push({
          id,
          role: "change",
          text: fileChangeSummary(item),
          status: firstString(item.status) ?? "completed",
        });
      } else if (type === "webSearch") {
        entries.push(...webSearchTranscriptEntries(item, id));
      } else if (type === "mcpToolCall") {
        entries.push({
          id,
          role: "tool",
          text: firstString(item.tool, item.name, type) ?? type,
          toolType: "mcpToolCall",
          command: firstString(item.server, item.query, item.arguments) ?? "",
          output: firstString(item.result, item.content) ?? "",
          status: firstString(item.status) ?? "completed",
        });
      }
    }
  }
  return entries;
}

function webSearchTranscriptEntries(item: JsonObject, id: string): TranscriptEntry[] {
  const action = asObject(item.action);
  const queries = Array.isArray(action?.queries)
    ? action.queries.flatMap((query) => typeof query === "string" && query.trim() ? [query.trim()] : [])
    : [];
  const searchQueries = queries.length ? queries : [firstString(action?.query, item.query) ?? ""];
  const status = firstString(item.status) ?? "completed";
  return searchQueries.map((query, index) => ({
    id: searchQueries.length > 1 ? `${id}:query:${index + 1}` : id,
    role: "tool",
    text: "WebSearch",
    toolType: "webSearch",
    command: query || "웹 검색",
    output: firstString(item.result, item.content) ?? "",
    status,
  }));
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((partValue) => {
    const part = asObject(partValue);
    if (typeof partValue === "string") return partValue;
    return firstString(part?.text, part?.inputText, part?.outputText) ?? "";
  }).filter(Boolean).join("\n");
}

function fileChangeSummary(item: JsonObject): string {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const paths = changes.map((change) => firstString(asObject(change)?.path)).filter(Boolean);
  return paths.length ? paths.join("\n") : "File changes";
}

async function buildPrompt(
  target: string,
  threadId: string,
  text: string,
  catalog: SkillCatalog | undefined,
): Promise<string> {
  const invocation = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/i);
  if (!invocation) return text;
  if (!catalog) throw new Error("Remote skills have not been loaded for this session");

  const selector = invocation[1]!;
  const request = invocation[2]?.trim() ?? "";
  const [prefix, ...nameParts] = selector.split(":");
  const qualified = ["codex", "pi", "shared"].includes(prefix?.toLowerCase() ?? "");
  const provider = qualified ? prefix!.toLowerCase() : undefined;
  const name = qualified ? nameParts.join(":") : selector;
  const matches = catalog.skills.filter((skill) =>
    skill.name === name && (!provider || skill.provider.toLowerCase() === provider),
  );
  if (matches.length > 1) {
    const choices = matches.map((skill) => `/skill:${skill.provider.toLowerCase()}:${skill.name}`).join("  ");
    throw new Error(`Skill name '${name}' is ambiguous. Choose ${choices}`);
  }
  const skill = matches[0];
  if (!skill) throw new Error(`No available skill named '${selector}'. Open Skills to browse remote skills.`);
  if (!skill.enabled) throw new Error(`The '${skill.name}' skill is disabled`);

  return buildSkillInput(target, skill, request);
}

async function buildSkillInput(target: string, skill: AvailableSkill, request: string): Promise<string> {
  if (skill.provider !== "Pi") {
    const prompt = skill.defaultPrompt?.trim() || `Use $${skill.name} to handle this request.`;
    return request ? `${prompt}\n\nUser request: ${request}` : prompt;
  }
  const instructions = await readPiSkill(target, skill);
  const selectedTask = request || "Apply this skill to the current session and ask me if you need more input.";
  const skillDirectory = dirname(skill.path);
  return [
    `Use the explicitly selected Pi skill '${skill.name}'. Follow its instructions and resolve any relative skill resources from '${skillDirectory}'.`,
    "The skill remains on the daemon host; Hive only sends its entrypoint for this invocation.",
    "",
    `--- BEGIN PI SKILL: ${skill.name} ---`,
    instructions,
    `--- END PI SKILL: ${skill.name} ---`,
    "",
    `User request: ${selectedTask}`,
  ].join("\n");
}

function buildOpenCodeSkillInput(skill: OpenCodeSkill, request: string): string {
  const skillDirectory = skill.path ? dirname(skill.path) : "the skill's directory";
  const selectedTask = request.trim() || "Apply this skill to the current session and ask me if you need more input.";
  return [
    `Use the explicitly selected OpenCode skill '${skill.id}' (${skill.name}). Follow its instructions and resolve relative skill resources from '${skillDirectory}'.`,
    "",
    `--- BEGIN OPENCODE SKILL: ${skill.id} ---`,
    skill.content,
    `--- END OPENCODE SKILL: ${skill.id} ---`,
    "",
    `User request: ${selectedTask}`,
  ].join("\n");
}

function handleServerRequest(
  session: RemoteSession,
  target: string,
  method: string,
  params: unknown,
  requestId: number | string,
): void {
  const threadId = eventThreadId(params) ?? session.activeThreadId;
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    if (!threadId) {
      session.api.respondToRequest(requestId, { decision: "decline" });
      return;
    }
    publishBridgeEvent({ target, threadId, method, params, provider: "codex", requestId });
    return;
  }
  if (method === "item/permissions/requestApproval") {
    session.api.respondToRequest(requestId, { permissions: [] });
    return;
  }
  if (method === "mcpServer/elicitation/request") {
    session.api.respondToRequest(requestId, { action: "decline", content: null });
    return;
  }
  session.api.respondWithError(requestId, -32601, `Hive does not support server request: ${method}`);
}

function eventThreadId(params: unknown): string | undefined {
  return firstString(asObject(params)?.threadId, asObject(params)?.thread_id);
}

function toRemoteSkill(skill: AvailableSkill): RemoteSkill {
  return {
    id: remoteSkillId(skill),
    name: skill.name,
    description: skill.description,
    provider: skill.provider,
    scope: skill.scope,
    enabled: skill.enabled,
  };
}

function remoteSkillId(skill: AvailableSkill): string {
  return JSON.stringify([skill.provider, skill.name, skill.path]);
}

function toRemoteOpenCodeSkill(skill: OpenCodeSkill): RemoteSkill {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    provider: "OpenCode",
    scope: skill.path ? dirname(skill.path) : "OpenCode",
    enabled: skill.enabled,
  };
}

function validateThreadId(threadId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) throw new Error("Thread ID contains unsupported characters");
}

function connectionFriendlyError(target: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (target === LOCAL_CODEX_TARGET) {
    return `로컬 Codex에 연결하지 못했습니다: ${message}\n확인: 데몬을 실행한 사용자 환경에서 'codex app-server'를 실행할 수 있고 Codex 로그인이 되어 있어야 합니다.`;
  }
  if (target.startsWith("hive+tcp://") || target.startsWith("hive+tls://")) return "TCP 릴레이 연결 실패: " + message;
  if (message.includes("Permission denied")) return `${message}\n확인: SSH 공개키 로그인과 ~/.ssh/config의 호스트 별칭을 점검하세요.`;
  if (/codex:.*not found|codex: 명령을 찾을 수 없음/i.test(message)) {
    return `${message}\n확인: 원격 컴퓨터에 Codex CLI가 설치되어 있고 비대화형 SSH 셸의 PATH에서 codex를 찾을 수 있어야 합니다.`;
  }
  return message;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function dispatchDaemonRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!isDaemonApiMethod(method)) throw new Error("Unsupported daemon request");

  if (isProviderDaemonApiMethod(method)) {
    const provider = params.provider ?? DEFAULT_ASSISTANT_PROVIDER;
    if (!isAssistantProvider(provider)) {
      const available = ASSISTANT_PROVIDERS.map((item) => item.id).join(", ");
      throw new Error(`Unsupported assistant provider. Available providers: ${available}`);
    }
    return await providerRequestHandlers[method]({ ...params, provider });
  }

  return await daemonRequestHandlers[method](params);
}
