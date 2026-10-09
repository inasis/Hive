import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { JsonObject, PiOpenSession, PiProviderTarget, PiThreadDescriptor } from "./session-types.js";
import type { PiRpcProcess } from "./rpc-process.js";
import { listPiSessions } from "./session-files.js";
import { modelKey, parseModelId } from "./model-catalog.js";
import { mapPiSessionState, readOptionalPiSessionFile, requirePiSessionFile } from "./session-state-mapper.js";

type PiRpcFactory = (
  cwd: string,
  sessionFile?: string,
  onRecord?: (record: JsonObject) => void,
  initialModel?: string,
  noSession?: boolean,
  providerId?: string,
  callerAgentId?: string,
) => PiRpcProcess;

export type PiSessionThreadLifecycleOptions = {
  sessionDirectory: string;
  createRpc: PiRpcFactory;
};

/** Opens, creates, and forks provider threads within an initialized Pi target. */
export class PiSessionThreadLifecycle {
  constructor(private readonly options: PiSessionThreadLifecycleOptions) {}

  async open(state: PiProviderTarget, threadId: string, onRecord?: (record: JsonObject) => void): Promise<PiOpenSession> {
    const opened = state.opened.get(threadId);
    if (opened) return opened;
    const descriptor = state.threads.get(threadId) ?? await this.findStoredThread(state, threadId);
    if (!descriptor) throw new Error("Pi 세션을 찾을 수 없습니다. 목록을 새로고침하세요.");
    const client = this.options.createRpc(descriptor.thread.cwd, descriptor.sessionFile, onRecord);
    try {
      await client.start();
      const current = mapPiSessionState(await client.request({ type: "get_state" }));
      if (current.sessionId !== threadId) throw new Error("Pi가 다른 세션을 열었습니다.");
      const model = current.model;
      const currentName = current.sessionName ?? descriptor.sessionName;
      const effort = current.thinkingLevel;
      const session: PiOpenSession = {
        ...descriptor,
        thread: { ...descriptor.thread, ...(currentName ? { title: currentName } : {}) },
        ...(model ? { model: `${model.provider}/${model.id}` } : {}),
        ...(effort ? { effort } : {}),
        ...(currentName ? { sessionName: currentName } : {}),
        client,
      };
      state.opened.set(threadId, session);
      state.threads.set(threadId, session);
      return session;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async startNew(
    state: PiProviderTarget,
    cwd: string,
    model: string,
    sessionName?: string,
    onRecord?: (record: JsonObject) => void,
    callerAgentId?: string,
  ): Promise<PiOpenSession> {
    const realCwd = resolve(cwd);
    const parsedModel = parseModelId(model);
    if (!state.piModels.has(model)) throw new Error("선택한 Pi 모델을 사용할 수 없습니다.");
    await mkdir(this.options.sessionDirectory, { recursive: true, mode: 0o700 });
    const client = this.options.createRpc(realCwd, undefined, onRecord, parsedModel.id, false, parsedModel.provider, callerAgentId);
    try {
      await client.start();
      if (sessionName?.trim()) await client.request({ type: "set_session_name", name: sessionName.trim() });
      const current = mapPiSessionState(await client.request({ type: "get_state" }));
      const threadId = current.sessionId;
      const sessionFile = readOptionalPiSessionFile(current.sessionFile);
      if (!sessionFile) throw new Error("Pi did not return a session file path.");
      const name = current.sessionName ?? sessionName?.trim();
      const effort = current.thinkingLevel;
      const descriptor: PiOpenSession = {
        thread: {
          id: threadId,
          provider: "pi",
          title: name || "새 Pi 세션",
          cwd: realCwd,
          preview: "",
          updatedAt: Date.now(),
        },
        sessionFile,
        model: modelKey(parsedModel.provider, parsedModel.id),
        ...(effort ? { effort } : {}),
        ...(name ? { sessionName: name } : {}),
        client,
      };
      state.threads.set(threadId, descriptor);
      state.opened.set(threadId, descriptor);
      return descriptor;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async duplicateForFork(
    state: PiProviderTarget,
    source: PiOpenSession,
    entryId: string | undefined,
    onRecord?: (record: JsonObject) => void,
  ): Promise<PiOpenSession> {
    const client = this.options.createRpc(source.thread.cwd, source.sessionFile, onRecord);
    try {
      await client.start();
      await client.request(entryId ? { type: "fork", entryId } : { type: "clone" });
      const current = mapPiSessionState(await client.request({ type: "get_state" }), "Pi fork session ID");
      const forkId = current.sessionId;
      const sessionFile = requirePiSessionFile(current.sessionFile, "Pi fork session file");
      const name = current.sessionName;
      const piModel = current.model;
      const effort = current.thinkingLevel;
      const descriptor: PiOpenSession = {
        thread: {
          id: forkId,
          provider: "pi",
          title: name ?? `${source.thread.title} (fork)`,
          cwd: source.thread.cwd,
          preview: source.thread.preview,
          updatedAt: Date.now(),
        },
        sessionFile,
        ...(piModel ? { model: modelKey(piModel.provider, piModel.id) } : source.model ? { model: source.model } : {}),
        ...(effort ? { effort } : {}),
        ...(name ? { sessionName: name } : {}),
        client,
      };
      state.threads.set(forkId, descriptor);
      state.opened.set(forkId, descriptor);
      return descriptor;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async findStoredThread(state: PiProviderTarget, threadId: string): Promise<PiThreadDescriptor | undefined> {
    const descriptor = (await listPiSessions(this.options.sessionDirectory)).find((item) => item.thread.id === threadId);
    if (descriptor) state.threads.set(threadId, descriptor);
    return descriptor;
  }
}
