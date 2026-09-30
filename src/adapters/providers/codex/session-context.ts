import type { SkillCatalog } from "../../../application/ports/skills.js";
import type { CodexCliEvent } from "../../../application/ports/codex-cli.js";
import type { AssistantModel } from "../../../domain/assistant.js";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { parseHiveRelayTarget } from "../../transport/relay-target.js";
import { CodexAppServerApi } from "./app-server.js";
import { mapCodexCliNotification } from "./cli-events.js";

export type CodexRemoteSession = {
  api: CodexAppServerApi;
  activeThreadId?: string;
  openedThreadIds: Set<string>;
  freshThreadIds: Set<string>;
  unsubscribe: () => void;
  skillsByThread: Map<string, SkillCatalog>;
  models: AssistantModel[];
  settingsByThread: Map<string, { model: string; effort: string | null; permissionProfile: string | null; collaborationMode?: "default" | "plan" }>;
};

export type CodexNotificationHandler = (
  target: string,
  session: CodexRemoteSession,
  method: string,
  params: unknown,
  requestId?: number | string,
) => void;

/** Owns Codex app-server connections and per-target session lifetime. */
export class CodexSessionContext {
  private readonly sessions = new Map<string, CodexRemoteSession>();
  private readonly connecting = new Map<string, Promise<CodexRemoteSession>>();

  constructor(
    private readonly onNotification: CodexNotificationHandler,
    private readonly publishCliEvent?: (event: CodexCliEvent) => void,
  ) {}

  get(target: string): CodexRemoteSession | undefined {
    return this.sessions.get(target);
  }

  async getOrConnect(target: string): Promise<CodexRemoteSession> {
    const existing = this.sessions.get(target);
    if (existing) return existing;
    const pending = this.connecting.get(target);
    if (pending) return pending;

    const task = (async () => {
      const api = await CodexAppServerApi.connect(target);
      const session: CodexRemoteSession = {
        api,
        openedThreadIds: new Set(),
        freshThreadIds: new Set(),
        unsubscribe: () => {},
        skillsByThread: new Map(),
        models: [],
        settingsByThread: new Map(),
      };
      session.unsubscribe = api.onNotification((method, params, requestId) => {
        this.onNotification(target, session, method, params, requestId);
        const event = mapCodexCliNotification(target, session.activeThreadId, method, params, requestId);
        if (event) this.publishCliEvent?.(event);
      });
      this.sessions.set(target, session);
      return session;
    })();
    this.connecting.set(target, task);
    try {
      return await task;
    } catch (error) {
      throw new Error(connectionFriendlyError(target, error));
    } finally {
      this.connecting.delete(target);
    }
  }

  async disconnect(target: string): Promise<void> {
    const session = this.sessions.get(target);
    if (!session) return;
    this.sessions.delete(target);
    session.unsubscribe();
    await session.api.close();
  }
}

function connectionFriendlyError(target: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (target === LOCAL_WORKSPACE_TARGET) {
    return `로컬 Codex에 연결하지 못했습니다: ${message}\n확인: 데몬을 실행한 사용자 환경에서 'codex app-server'를 실행할 수 있고 Codex 로그인이 되어 있어야 합니다.`;
  }
  if (target.startsWith("hive+tcp://") || target.startsWith("hive+tls://")) return "TCP 릴레이 연결 실패: " + message;
  if (message.includes("Permission denied")) return `${message}\n확인: SSH 공개키 로그인과 ~/.ssh/config의 호스트 별칭을 점검하세요.`;
  if (/codex:.*not found|codex: 명령을 찾을 수 없음/i.test(message)) {
    return `${message}\n확인: 원격 컴퓨터에 Codex CLI가 설치되어 있고 비대화형 SSH 셸의 PATH에서 codex를 찾을 수 있어야 합니다.`;
  }
  return message;
}

export function formatCodexTargetLabel(target: string): string {
  const relay = parseHiveRelayTarget(target);
  return relay
    ? (relay.tls ? "hive+tls://" : "hive+tcp://") + (relay.host.includes(":") ? `[${relay.host}]` : relay.host) + `:${relay.port}/${relay.pairId}`
    : target;
}
