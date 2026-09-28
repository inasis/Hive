import type { IPty } from "@lydell/node-pty";
import type { AssistantCommand, AssistantMode, AssistantModel, AssistantSkill, TranscriptEntry } from "../../../domain/assistant.js";
import { KiroAcpConnection } from "./acp-connection.js";
import type { KiroNotification, KiroServerRequest } from "./acp-rpc.js";

type JsonObject = Record<string, unknown>;

export type KiroRemoteTerminal = {
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

export type KiroRemoteSession = {
  connection: KiroAcpConnection;
  openedThreadIds: Set<string>;
  settingsByThread: Map<string, { model: string; effort: string | null }>;
  cwdByThread: Map<string, string>;
  models: AssistantModel[];
  commandsByThread: Map<string, AssistantCommand[]>;
  skillsByThread: Map<string, AssistantSkill[]>;
  modesByThread: Map<string, AssistantMode[]>;
  currentModeByThread: Map<string, string>;
  policyPresetsByThread: Map<string, string[]>;
  transcriptsByThread: Map<string, TranscriptEntry[]>;
  activeTurnIds: Map<string, string>;
  pendingApprovals: Map<string, { threadId: string; options: JsonObject[] }>;
  terminalsById: Map<string, KiroRemoteTerminal>;
  updateUnsubscribers: Map<string, () => void>;
};

export type KiroServerRequestHandler = (
  session: KiroRemoteSession,
  target: string,
  request: KiroServerRequest,
) => void | Promise<void>;
export type KiroNotificationHandler = (
  session: KiroRemoteSession,
  target: string,
  notification: KiroNotification,
) => void;

/** Owns Kiro ACP processes, per-target state, and stale-session recovery metadata. */
export class KiroSessionContext {
  private readonly sessions = new Map<string, KiroRemoteSession>();
  private readonly connecting = new Map<string, Promise<KiroRemoteSession>>();
  private readonly disconnectedThreads = new Map<string, Set<string>>();
  private readonly targetMaintenance = new Map<string, Promise<unknown>>();

  constructor(
    private readonly onServerRequest: KiroServerRequestHandler,
    private readonly onNotification: KiroNotificationHandler,
  ) {}

  get(target: string): KiroRemoteSession | undefined {
    return this.sessions.get(target);
  }

  require(target: string): KiroRemoteSession {
    const session = this.sessions.get(target);
    if (!session) throw new Error("Kiro 연결이 만료되었습니다. 연결 설정에서 다시 연결하세요.");
    if (!session.connection.isOpen) throw new Error("Kiro ACP 연결이 종료되었습니다. 세션을 다시 열어 연결을 복구하세요.");
    return session;
  }

  isThreadDisconnected(target: string, threadId: string): boolean {
    return Boolean(this.disconnectedThreads.get(target)?.has(threadId));
  }

  forgetDisconnectedThread(target: string, threadId: string): void {
    const disconnected = this.disconnectedThreads.get(target);
    disconnected?.delete(threadId);
    if (disconnected?.size === 0) this.disconnectedThreads.delete(target);
  }

  async runAfterClosingConnection<T>(target: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.targetMaintenance.get(target);
    if (previous) await previous.catch(() => undefined);

    const task = (async () => {
      const connecting = this.connecting.get(target);
      if (connecting) await connecting.catch(() => undefined);
      const session = this.sessions.get(target);
      if (session) {
        if (session.connection.isOpen && session.activeTurnIds.size) {
          throw new Error("Kiro is processing a response. Stop it before deleting a session.");
        }
        if (session.connection.isOpen && session.pendingApprovals.size) {
          throw new Error("Resolve the pending Kiro permission request before deleting a session.");
        }
        await this.disposeSession(target, session);
      }
      return operation();
    })();
    this.targetMaintenance.set(target, task);
    try {
      return await task;
    } finally {
      if (this.targetMaintenance.get(target) === task) this.targetMaintenance.delete(target);
    }
  }

  async getOrConnect(target: string): Promise<KiroRemoteSession> {
    await this.targetMaintenance.get(target)?.catch(() => undefined);
    const existing = this.sessions.get(target);
    if (existing?.connection.isOpen) return existing;
    const pending = this.connecting.get(target);
    if (pending) return pending;
    const task = (async () => {
      if (existing && this.sessions.get(target) === existing) {
        await this.disposeSession(target, existing);
      }
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
      connection.onServerRequest((request) => { void this.onServerRequest(session, target, request); });
      connection.onNotification((notification) => this.onNotification(session, target, notification));
      this.sessions.set(target, session);
      return session;
    })();
    this.connecting.set(target, task);
    try {
      return await task;
    } finally {
      this.connecting.delete(target);
    }
  }

  async disconnect(target: string): Promise<void> {
    await this.targetMaintenance.get(target)?.catch(() => undefined);
    const session = this.sessions.get(target);
    this.disconnectedThreads.delete(target);
    if (!session) return;
    this.sessions.delete(target);
    session.pendingApprovals.clear();
    closeKiroTerminals(session);
    await session.connection.close();
  }

  terminateAll(): void {
    for (const session of this.sessions.values()) {
      closeKiroTerminals(session);
      session.connection.terminate();
    }
  }

  private async disposeSession(target: string, session: KiroRemoteSession): Promise<void> {
    if (this.sessions.get(target) === session) this.sessions.delete(target);
    if (session.openedThreadIds.size) {
      const disconnected = this.disconnectedThreads.get(target) ?? new Set<string>();
      for (const threadId of session.openedThreadIds) disconnected.add(threadId);
      this.disconnectedThreads.set(target, disconnected);
    }
    session.pendingApprovals.clear();
    for (const unsubscribe of session.updateUnsubscribers.values()) unsubscribe();
    session.updateUnsubscribers.clear();
    closeKiroTerminals(session);
    await session.connection.close();
  }
}

function closeKiroTerminals(session: KiroRemoteSession): void {
  for (const terminal of session.terminalsById.values()) {
    if (!terminal.exited) terminal.pty.kill();
  }
  session.terminalsById.clear();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
